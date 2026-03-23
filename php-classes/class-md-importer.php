<?php
/**
 * Reverse sync: Imports existing Markdown files into WordPress.
 *
 * On every admin_init, checks if there are .md files in the content
 * directories (blog/ and pages/) that don't have a corresponding WP post.
 * If so, imports them.
 *
 * Uses a checksum manifest to skip files that haven't changed since last
 * import — avoids re-parsing, block conversion, and image imports for
 * unchanged content.
 *
 * Converts Markdown to Gutenberg block markup so posts are fully editable
 * in the block editor. Also imports images into the WP Media Library.
 */
class Astro_MD_Importer {

    /**
     * Path to the import manifest file.
     * Stores MD5 hashes of imported .md files to skip unchanged ones.
     */
    private $manifest_path;

    /**
     * In-memory manifest: filename => md5 hash.
     */
    private $manifest = [];

    public function __construct() {
        $this->manifest_path = WP_CONTENT_DIR . '/astro-content/.import-manifest.json';
        add_action( 'admin_init', [ $this, 'maybe_import' ] );
    }

    /**
     * Check if import is needed and run it.
     * Uses a transient to avoid running on every admin page load.
     */
    public function maybe_import() {
        // Only run once per session
        if ( get_transient( 'astro_import_done' ) ) {
            return;
        }
        set_transient( 'astro_import_done', true, DAY_IN_SECONDS );

        // Set a flag so the exporter knows to skip during import
        define( 'ASTRO_IMPORTING', true );

        // Load existing manifest
        $this->manifest = $this->load_manifest();
        $new_manifest   = [];
        $imported        = 0;
        $skipped         = 0;

        // Import blog posts
        if ( is_dir( ASTRO_EXPORT_DIR ) ) {
            $files = glob( ASTRO_EXPORT_DIR . '*.md' );
            if ( ! empty( $files ) ) {
                foreach ( $files as $file ) {
                    $key  = 'blog/' . basename( $file );
                    $hash = md5_file( $file );
                    $new_manifest[ $key ] = $hash;

                    // Skip if file hasn't changed
                    if ( isset( $this->manifest[ $key ] ) && $this->manifest[ $key ] === $hash ) {
                        $skipped++;
                        continue;
                    }

                    if ( $this->import_file( $file, 'post' ) ) {
                        $imported++;
                    }
                }
            }
        }

        // Import pages
        if ( is_dir( ASTRO_PAGES_EXPORT_DIR ) ) {
            $files = glob( ASTRO_PAGES_EXPORT_DIR . '*.md' );
            if ( ! empty( $files ) ) {
                foreach ( $files as $file ) {
                    $key  = 'pages/' . basename( $file );
                    $hash = md5_file( $file );
                    $new_manifest[ $key ] = $hash;

                    // Skip if file hasn't changed
                    if ( isset( $this->manifest[ $key ] ) && $this->manifest[ $key ] === $hash ) {
                        $skipped++;
                        continue;
                    }

                    if ( $this->import_file( $file, 'page' ) ) {
                        $imported++;
                    }
                }
            }
        }

        // Save updated manifest
        $this->save_manifest( $new_manifest );

        // Delete the default "Hello world!" post if we imported real content
        if ( $imported > 0 ) {
            $hello_world = get_page_by_path( 'hello-world', OBJECT, 'post' );
            if ( $hello_world ) {
                wp_delete_post( $hello_world->ID, true );
            }
            // Also delete the default "Sample Page"
            $sample_page = get_page_by_path( 'sample-page', OBJECT, 'page' );
            if ( $sample_page ) {
                wp_delete_post( $sample_page->ID, true );
            }
        }
    }

    // ─── Manifest helpers ───────────────────────────────────────────

    /**
     * Load the import manifest from disk.
     *
     * @return array Associative array of filename => md5 hash.
     */
    private function load_manifest() {
        if ( ! file_exists( $this->manifest_path ) ) {
            return [];
        }

        $json = file_get_contents( $this->manifest_path );
        $data = json_decode( $json, true );

        return is_array( $data ) ? $data : [];
    }

    /**
     * Save the import manifest to disk.
     *
     * @param array $manifest Associative array of filename => md5 hash.
     */
    private function save_manifest( $manifest ) {
        $dir = dirname( $this->manifest_path );
        if ( ! is_dir( $dir ) ) {
            mkdir( $dir, 0755, true );
        }

        file_put_contents(
            $this->manifest_path,
            json_encode( $manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES )
        );
    }

    // ─── File import ────────────────────────────────────────────────

    /**
     * Import a single .md file as a WordPress post or page.
     *
     * @param string $file_path Full path to the .md file.
     * @param string $post_type 'post' or 'page'.
     * @return bool True if imported/updated, false on failure.
     */
    private function import_file( $file_path, $post_type = 'post' ) {
        $slug = basename( $file_path, '.md' );
        $raw  = file_get_contents( $file_path );

        if ( empty( $raw ) ) {
            return false;
        }

        // Parse frontmatter
        if ( ! preg_match( '/^---\s*\n(.*?)\n---\s*\n(.*)/s', $raw, $matches ) ) {
            return false;
        }

        $meta    = $this->parse_yaml( $matches[1] );
        $body_md = trim( $matches[2] );

        $title      = $meta['title'] ?? $slug;
        $excerpt    = $meta['description'] ?? '';
        $pub_date   = $meta['pubDate'] ?? current_time( 'mysql' );
        $is_draft   = isset( $meta['draft'] ) && ( $meta['draft'] === 'true' || $meta['draft'] === true );
        $hero_image = $meta['heroImage'] ?? '';
        $menu_order = isset( $meta['menuOrder'] ) ? intval( $meta['menuOrder'] ) : 0;

        // Post-specific fields
        $categories = $meta['categories'] ?? [];
        $tags       = $meta['tags'] ?? [];

        // Import images referenced in the markdown body into WP Media Library
        // and rewrite their paths to WP attachment URLs
        $body_md = $this->import_and_rewrite_images( $body_md );

        // Convert Markdown to Gutenberg block markup
        $block_content = Astro_MD_To_Blocks::convert( $body_md );

        // Check if post/page with this slug exists
        $existing = get_page_by_path( $slug, OBJECT, $post_type );

        $post_data = [
            'post_title'   => $title,
            'post_name'    => $slug,
            'post_content' => $block_content,
            'post_type'    => $post_type,
            'post_status'  => $is_draft ? 'draft' : 'publish',
            'post_excerpt' => $excerpt,
            'post_author'  => 1,
            'menu_order'   => $menu_order,
        ];

        // Only set post_date for posts (pages don't need it)
        if ( $post_type === 'post' && ! empty( $pub_date ) ) {
            $post_data['post_date'] = date( 'Y-m-d H:i:s', strtotime( $pub_date ) );
        }

        if ( $existing ) {
            $post_data['ID'] = $existing->ID;
            $post_id = wp_update_post( $post_data, true );
        } else {
            $post_id = wp_insert_post( $post_data, true );
        }

        if ( is_wp_error( $post_id ) ) {
            return false;
        }

        // Set featured image from heroImage frontmatter
        if ( ! empty( $hero_image ) ) {
            $attachment_id = $this->import_image_to_media_library( $hero_image );
            if ( $attachment_id ) {
                set_post_thumbnail( $post_id, $attachment_id );
            }
        }

        // Set categories and tags (only for posts)
        if ( $post_type === 'post' ) {
            if ( ! empty( $categories ) ) {
                $cat_ids = [];
                foreach ( $categories as $cat_name ) {
                    $term = term_exists( $cat_name, 'category' );
                    if ( ! $term ) {
                        $term = wp_insert_term( $cat_name, 'category' );
                    }
                    if ( ! is_wp_error( $term ) ) {
                        $cat_ids[] = is_array( $term ) ? (int) $term['term_id'] : (int) $term;
                    }
                }
                wp_set_post_categories( $post_id, $cat_ids );
            }

            if ( ! empty( $tags ) ) {
                wp_set_post_tags( $post_id, $tags );
            }
        }

        return true;
    }

    // ─── Image handling ─────────────────────────────────────────────

    /**
     * Find all image references in Markdown, import them to Media Library,
     * and rewrite the paths to WP attachment URLs.
     *
     * @param string $md Markdown content.
     * @return string Markdown with rewritten image paths.
     */
    private function import_and_rewrite_images( $md ) {
        // Match ![alt](/assets/images/filename.ext) patterns
        return preg_replace_callback(
            '/!\[([^\]]*)\]\(([^)]+)\)/',
            function( $m ) {
                $alt = $m[1];
                $src = $m[2];

                // Only import local /assets/images/ paths
                if ( strpos( $src, '/assets/images/' ) !== 0 &&
                     strpos( $src, ASTRO_IMAGES_URL_PREFIX ) !== 0 ) {
                    return $m[0]; // External URL — leave as-is
                }

                $attachment_id = $this->import_image_to_media_library( $src );
                if ( $attachment_id ) {
                    $new_url = wp_get_attachment_url( $attachment_id );
                    return "![$alt]($new_url)";
                }

                return $m[0]; // Import failed — leave original
            },
            $md
        );
    }

    /**
     * Import an image file from the Astro images directory into the WP Media Library.
     *
     * @param string $image_path Relative path like /assets/images/photo.jpg
     * @return int|false Attachment ID or false on failure.
     */
    private function import_image_to_media_library( $image_path ) {
        $filename = basename( $image_path );

        // Check if already imported (by filename in attachment titles)
        $existing = get_posts([
            'post_type'      => 'attachment',
            'post_status'    => 'inherit',
            'meta_key'       => '_astro_original_path',
            'meta_value'     => $image_path,
            'posts_per_page' => 1,
        ]);
        if ( ! empty( $existing ) ) {
            return $existing[0]->ID;
        }

        // Find the actual file in the mounted images directory.
        // WordPress sometimes uses Unicode × (U+00D7) instead of ASCII x
        // in dimension strings like "1024×693". Try both variants.
        $source_file = ASTRO_IMAGES_DIR . $filename;
        if ( ! file_exists( $source_file ) ) {
            // Try replacing Unicode × with ASCII x
            $normalized = str_replace( '×', 'x', $filename );
            $source_file = ASTRO_IMAGES_DIR . $normalized;
            if ( ! file_exists( $source_file ) ) {
                // Try the reverse too (ASCII x → Unicode ×)
                $alt_name = str_replace( 'x', '×', $filename );
                $source_file = ASTRO_IMAGES_DIR . $alt_name;
                if ( ! file_exists( $source_file ) ) {
                    return false;
                }
            }
            $filename = basename( $source_file );
        }

        // Copy to WP uploads directory
        $upload_dir = wp_upload_dir();
        $dest_file  = $upload_dir['path'] . '/' . $filename;

        if ( ! @copy( $source_file, $dest_file ) ) {
            return false;
        }

        // Determine MIME type
        $mime_types = [
            'jpg'  => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png'  => 'image/png',
            'gif'  => 'image/gif',
            'webp' => 'image/webp',
            'svg'  => 'image/svg+xml',
            'avif' => 'image/avif',
        ];
        $ext  = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
        $mime = $mime_types[ $ext ] ?? 'image/jpeg';

        // Create the attachment post
        $attachment = [
            'post_title'     => pathinfo( $filename, PATHINFO_FILENAME ),
            'post_mime_type' => $mime,
            'post_status'    => 'inherit',
            'guid'           => $upload_dir['url'] . '/' . $filename,
        ];

        $attachment_id = wp_insert_attachment( $attachment, $dest_file );
        if ( is_wp_error( $attachment_id ) || ! $attachment_id ) {
            return false;
        }

        // Generate metadata (thumbnails, dimensions, etc.)
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $metadata = wp_generate_attachment_metadata( $attachment_id, $dest_file );
        wp_update_attachment_metadata( $attachment_id, $metadata );

        // Tag it so we can find it on subsequent imports
        update_post_meta( $attachment_id, '_astro_original_path', $image_path );

        return $attachment_id;
    }

    // ─── YAML parser ────────────────────────────────────────────────

    /**
     * Simple YAML frontmatter parser.
     * Handles our known format: strings, arrays, booleans.
     */
    private function parse_yaml( $yaml ) {
        $result      = [];
        $lines       = explode( "\n", $yaml );
        $current_key = null;

        foreach ( $lines as $line ) {
            // Array item: "  - "value"" or "  - value"
            if ( preg_match( '/^\s+-\s+"?([^"]*)"?\s*$/', $line, $m ) ) {
                if ( $current_key ) {
                    if ( ! isset( $result[ $current_key ] ) || ! is_array( $result[ $current_key ] ) ) {
                        $result[ $current_key ] = [];
                    }
                    $result[ $current_key ][] = trim( $m[1], '"' );
                }
                continue;
            }

            // Key-value: "key: value"
            if ( preg_match( '/^(\w[\w]*?):\s*(.*)$/', $line, $m ) ) {
                $current_key = $m[1];
                $value       = trim( $m[2] );

                if ( $value === '' ) {
                    // Array follows
                    $result[ $current_key ] = [];
                } else {
                    // Scalar — strip quotes
                    $value = trim( $value, '"' );
                    $value = str_replace( '\\"', '"', $value );

                    // Handle booleans
                    if ( $value === 'true' ) $value = true;
                    elseif ( $value === 'false' ) $value = false;

                    $result[ $current_key ] = $value;
                }
            }
        }

        return $result;
    }
}
