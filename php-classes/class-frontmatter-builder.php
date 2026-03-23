<?php
/**
 * Builds YAML frontmatter from a WP_Post object.
 *
 * Output format matches the Astro content collection schema
 * defined in src/content/config.ts.
 *
 * Handles both 'post' and 'page' post types with different schemas.
 */
class Astro_Frontmatter_Builder {

    /**
     * Build YAML frontmatter string for a post or page.
     *
     * @param WP_Post     $post       The post object.
     * @param string|null $hero_image Processed hero image path (relative).
     * @return string YAML frontmatter (without --- delimiters).
     */
    public static function build( $post, $hero_image = null ) {
        if ( $post->post_type === 'page' ) {
            return self::build_page( $post, $hero_image );
        }
        return self::build_post( $post, $hero_image );
    }

    /**
     * Build frontmatter for a blog post.
     */
    private static function build_post( $post, $hero_image = null ) {
        $fields = [];

        // Title
        $fields['title'] = $post->post_title;

        // Description / Excerpt
        $excerpt = get_the_excerpt( $post );
        if ( empty( $excerpt ) ) {
            $excerpt = wp_trim_words( strip_tags( $post->post_content ), 30, '...' );
        }
        $excerpt = html_entity_decode( $excerpt, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
        $fields['description'] = $excerpt;

        // Dates
        $fields['pubDate'] = get_the_date( 'Y-m-d\TH:i:s', $post );

        $modified = get_the_modified_date( 'Y-m-d\TH:i:s', $post );
        if ( $modified !== $fields['pubDate'] ) {
            $fields['updatedDate'] = $modified;
        }

        // Author
        $author = get_the_author_meta( 'display_name', $post->post_author );
        if ( ! empty( $author ) ) {
            $fields['author'] = $author;
        }

        // Categories
        $categories = wp_get_post_categories( $post->ID, [ 'fields' => 'names' ] );
        if ( ! is_wp_error( $categories ) && ! empty( $categories ) ) {
            $fields['categories'] = array_values( $categories );
        }

        // Tags
        $tags = wp_get_post_tags( $post->ID, [ 'fields' => 'names' ] );
        if ( ! is_wp_error( $tags ) && ! empty( $tags ) ) {
            $fields['tags'] = array_values( $tags );
        }

        // Hero image
        if ( ! empty( $hero_image ) ) {
            $fields['heroImage'] = $hero_image;
        }

        // Draft status
        $fields['draft'] = ( $post->post_status !== 'publish' );

        return self::to_yaml( $fields );
    }

    /**
     * Build frontmatter for a page (About, Contact, etc.).
     *
     * Pages have a simpler schema: no categories, tags, or pubDate.
     * They get a menuOrder field for navigation ordering.
     */
    private static function build_page( $post, $hero_image = null ) {
        $fields = [];

        // Title
        $fields['title'] = $post->post_title;

        // Description / Excerpt
        $excerpt = get_the_excerpt( $post );
        if ( empty( $excerpt ) ) {
            $excerpt = wp_trim_words( strip_tags( $post->post_content ), 30, '...' );
        }
        $excerpt = html_entity_decode( $excerpt, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
        $fields['description'] = $excerpt;

        // Last updated
        $modified = get_the_modified_date( 'Y-m-d\TH:i:s', $post );
        $fields['updatedDate'] = $modified;

        // Menu order (for nav sorting)
        $fields['menuOrder'] = $post->menu_order;

        // Hero image
        if ( ! empty( $hero_image ) ) {
            $fields['heroImage'] = $hero_image;
        }

        // Draft status
        $fields['draft'] = ( $post->post_status !== 'publish' );

        return self::to_yaml( $fields );
    }

    /**
     * Convert an associative array to YAML string.
     *
     * Handles strings, booleans, integers, arrays, and dates.
     * Produces clean YAML compatible with Astro's Zod schema parser.
     */
    private static function to_yaml( $data ) {
        $lines = [];

        foreach ( $data as $key => $value ) {
            if ( is_null( $value ) || ( is_string( $value ) && $value === '' ) ) {
                continue; // Omit empty values
            }

            if ( is_bool( $value ) ) {
                $lines[] = "$key: " . ( $value ? 'true' : 'false' );
            } elseif ( is_int( $value ) ) {
                $lines[] = "$key: $value";
            } elseif ( is_array( $value ) ) {
                if ( empty( $value ) ) {
                    continue; // Omit empty arrays
                }
                $lines[] = "$key:";
                foreach ( $value as $item ) {
                    $lines[] = '  - "' . self::escape_yaml_string( $item ) . '"';
                }
            } else {
                $lines[] = "$key: \"" . self::escape_yaml_string( (string) $value ) . '"';
            }
        }

        return implode( "\n", $lines ) . "\n";
    }

    /**
     * Escape a string for use inside YAML double quotes.
     */
    private static function escape_yaml_string( $str ) {
        $str = str_replace( '\\', '\\\\', $str );
        $str = str_replace( '"', '\\"', $str );
        $str = str_replace( "\n", '\\n', $str );
        $str = str_replace( "\t", '\\t', $str );
        return $str;
    }
}
