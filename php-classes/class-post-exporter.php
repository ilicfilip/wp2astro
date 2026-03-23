<?php
/**
 * Core export orchestrator.
 *
 * Hooks into WordPress post lifecycle and coordinates the
 * frontmatter builder, markdown converter, and image handler
 * to produce .md files in the Astro content directory.
 *
 * Supports both 'post' and 'page' post types.
 */
class Astro_Post_Exporter {

    /**
     * Post types we export.
     */
    private $supported_types = [ 'post', 'page' ];

    public function __construct() {
        // Export on publish/update
        add_action( 'save_post', [ $this, 'handle_save' ], 20, 3 );

        // Re-export when categories or tags change
        add_action( 'set_object_terms', [ $this, 'handle_terms_change' ], 20, 6 );

        // Delete .md when post is trashed or deleted
        add_action( 'wp_trash_post',      [ $this, 'handle_delete' ] );
        add_action( 'before_delete_post',  [ $this, 'handle_delete' ] );

        // Re-export when untrashed
        add_action( 'untrash_post', [ $this, 'handle_untrash' ] );
    }

    /**
     * Get the export directory for a given post type.
     *
     * @param string $post_type The WordPress post type.
     * @return string Directory path.
     */
    private function get_export_dir( $post_type ) {
        return $post_type === 'page' ? ASTRO_PAGES_EXPORT_DIR : ASTRO_EXPORT_DIR;
    }

    /**
     * Handle post save/update.
     */
    public function handle_save( $post_id, $post, $update ) {
        // Skip autosaves, revisions, and during MD import
        if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) return;
        if ( defined( 'ASTRO_IMPORTING' ) && ASTRO_IMPORTING ) return;
        if ( wp_is_post_revision( $post_id ) ) return;
        if ( wp_is_post_autosave( $post_id ) ) return;

        // Skip AJAX/REST autosave requests (heartbeat, block editor auto-saves)
        if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) return;
        if ( defined( 'REST_REQUEST' ) && REST_REQUEST && ! $this->is_explicit_save() ) return;

        // Only handle supported post types
        if ( ! in_array( $post->post_type, $this->supported_types, true ) ) return;

        // Skip auto-drafts (WP creates these when you open "Add New")
        if ( $post->post_status === 'auto-draft' ) return;

        // Export published and draft posts. Only delete .md on trash/other statuses.
        // The frontmatter builder sets draft: true/false based on post_status.
        if ( in_array( $post->post_status, [ 'publish', 'draft' ], true ) ) {
            $this->export_post( $post );
        } else {
            $this->delete_md_file( $post->post_name, $post->post_type );
        }
    }

    /**
     * Handle taxonomy (category/tag) changes.
     * Fires when terms are set on an object via set_object_terms.
     */
    public function handle_terms_change( $object_id, $terms, $tt_ids, $taxonomy, $append, $old_tt_ids ) {
        if ( defined( 'ASTRO_IMPORTING' ) && ASTRO_IMPORTING ) return;

        // Only care about category and post_tag taxonomies
        if ( ! in_array( $taxonomy, [ 'category', 'post_tag' ], true ) ) return;

        $post = get_post( $object_id );
        if ( ! $post || ! in_array( $post->post_type, $this->supported_types, true ) ) return;
        if ( $post->post_status !== 'publish' ) return;

        $this->export_post( $post );
    }

    /**
     * Handle post trash.
     */
    public function handle_delete( $post_id ) {
        $post = get_post( $post_id );
        if ( ! $post || ! in_array( $post->post_type, $this->supported_types, true ) ) return;
        $this->delete_md_file( $post->post_name, $post->post_type );
    }

    /**
     * Handle post untrash — re-export if it's published.
     */
    public function handle_untrash( $post_id ) {
        $post = get_post( $post_id );
        if ( ! $post || ! in_array( $post->post_type, $this->supported_types, true ) ) return;
        if ( $post->post_status === 'publish' ) {
            $this->export_post( $post );
        }
    }

    /**
     * Determine if the current REST request is an explicit user save
     * (not a Gutenberg autosave or heartbeat).
     *
     * Gutenberg autosaves hit /autosaves endpoint. Explicit saves
     * hit the post endpoint directly (PUT/POST to /wp/v2/posts/ID).
     *
     * @return bool
     */
    private function is_explicit_save() {
        $request_uri = $_SERVER['REQUEST_URI'] ?? '';
        // Autosaves go to .../autosaves — skip those
        if ( strpos( $request_uri, '/autosaves' ) !== false ) {
            return false;
        }
        // Explicit saves go to /wp/v2/posts/ID or /wp/v2/pages/ID
        if ( preg_match( '#/wp/v2/(posts|pages)/\d+#', $request_uri ) ) {
            return true;
        }
        return false;
    }

    /**
     * Export a single post or page to Markdown.
     */
    public function export_post( $post ) {
        $export_dir = $this->get_export_dir( $post->post_type );

        // Ensure output directory exists
        if ( ! is_dir( $export_dir ) ) {
            mkdir( $export_dir, 0755, true );
        }

        // 1. Handle images (copies files, returns updated content + hero path)
        $image_handler = new Astro_Image_Handler();
        $hero_image    = $image_handler->process_featured_image( $post );
        $content_html  = apply_filters( 'the_content', $post->post_content );
        $content_html  = $image_handler->process_inline_images( $content_html );

        // 2. Build frontmatter
        $frontmatter = Astro_Frontmatter_Builder::build( $post, $hero_image );

        // 3. Convert HTML to Markdown
        $markdown_body = Astro_Markdown_Converter::convert( $content_html );

        // 4. Determine slug — drafts may not have a post_name yet
        $slug = $post->post_name;
        if ( empty( $slug ) ) {
            // Generate slug from title, fall back to post ID
            $slug = sanitize_title( $post->post_title );
            if ( empty( $slug ) ) {
                $slug = 'draft-' . $post->ID;
            }
            // Persist the slug back to WP so it stays consistent
            wp_update_post( [
                'ID'        => $post->ID,
                'post_name' => $slug,
            ] );
        }
        $slug = sanitize_file_name( $slug );

        // 5. Combine and write
        $output = "---\n" . $frontmatter . "---\n\n" . $markdown_body . "\n";
        $path   = $export_dir . $slug . '.md';

        file_put_contents( $path, $output );
    }

    /**
     * Delete the .md file for a given slug.
     *
     * @param string $slug      The post slug.
     * @param string $post_type The post type (determines directory).
     */
    private function delete_md_file( $slug, $post_type = 'post' ) {
        $slug = sanitize_file_name( $slug );
        $path = $this->get_export_dir( $post_type ) . $slug . '.md';
        if ( file_exists( $path ) ) {
            unlink( $path );
        }
    }

    /**
     * Bulk export all published posts and pages. Called from admin page.
     *
     * @return array [ 'posts' => int, 'pages' => int ]
     */
    public function export_all() {
        $results = [ 'posts' => 0, 'pages' => 0 ];

        foreach ( $this->supported_types as $type ) {
            $items = get_posts([
                'post_type'      => $type,
                'post_status'    => [ 'publish', 'draft' ],
                'posts_per_page' => -1,
            ]);

            foreach ( $items as $item ) {
                $this->export_post( $item );
            }

            $results[ $type . 's' ] = count( $items );
        }

        return $results;
    }
}
