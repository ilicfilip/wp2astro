<?php
/**
 * Handles featured images and inline images in post content.
 *
 * Copies images from WP uploads to the Astro images directory
 * and rewrites URLs to use Astro-compatible paths.
 */
class Astro_Image_Handler {

    /**
     * Process the featured image (post thumbnail).
     *
     * Copies to ASTRO_IMAGES_DIR and returns the relative path
     * for use in frontmatter heroImage field.
     *
     * @param WP_Post $post
     * @return string|null Relative image path or null.
     */
    public function process_featured_image( $post ) {
        $thumbnail_id = get_post_thumbnail_id( $post->ID );
        if ( ! $thumbnail_id ) {
            return null;
        }

        $file_path = get_attached_file( $thumbnail_id );
        if ( ! $file_path || ! file_exists( $file_path ) ) {
            return null;
        }

        return $this->copy_image( $file_path );
    }

    /**
     * Process inline images in rendered HTML content.
     *
     * Finds all <img> tags with local WP URLs, copies the files
     * to ASTRO_IMAGES_DIR, and rewrites the src attributes.
     *
     * @param string $html Rendered post content HTML.
     * @return string HTML with rewritten image URLs.
     */
    public function process_inline_images( $html ) {
        $site_url = site_url();
        $upload_dir = wp_upload_dir();

        return preg_replace_callback(
            '/(<img[^>]*src=")([^"]*)(")/',
            function( $matches ) use ( $site_url, $upload_dir ) {
                $src = $matches[2];

                // Only process local images
                if ( strpos( $src, $site_url ) === false &&
                     strpos( $src, '/wp-content/uploads/' ) === false ) {
                    return $matches[0]; // External image — leave as-is
                }

                // Try to find the local file
                $local_path = $this->url_to_local_path( $src, $upload_dir );
                if ( ! $local_path || ! file_exists( $local_path ) ) {
                    return $matches[0]; // Can't find file — leave URL as-is
                }

                $new_path = $this->copy_image( $local_path );
                if ( ! $new_path ) {
                    return $matches[0];
                }

                return $matches[1] . $new_path . $matches[3];
            },
            $html
        );
    }

    /**
     * Copy an image file to the Astro images directory.
     *
     * @param string $source_path Absolute path to source image.
     * @return string|null Relative path for Astro, or null on failure.
     */
    private function copy_image( $source_path ) {
        if ( ! is_dir( ASTRO_IMAGES_DIR ) ) {
            mkdir( ASTRO_IMAGES_DIR, 0755, true );
        }

        $filename = basename( $source_path );
        // Normalize Unicode × to ASCII x in filenames (WP uses × for dimensions)
        $filename = str_replace( '×', 'x', $filename );
        $dest     = ASTRO_IMAGES_DIR . $filename;

        // Avoid overwriting with different content (same name, different file)
        if ( file_exists( $dest ) && md5_file( $source_path ) !== md5_file( $dest ) ) {
            // Append a hash to make unique
            $info     = pathinfo( $filename );
            $hash     = substr( md5_file( $source_path ), 0, 8 );
            $filename = $info['filename'] . '-' . $hash . '.' . $info['extension'];
            $dest     = ASTRO_IMAGES_DIR . $filename;
        }

        if ( ! file_exists( $dest ) ) {
            if ( ! @copy( $source_path, $dest ) ) {
                error_log( "WP Astro Exporter: Failed to copy image $source_path to $dest" );
                return null;
            }
        }

        return ASTRO_IMAGES_URL_PREFIX . $filename;
    }

    /**
     * Convert a WP URL to a local filesystem path.
     *
     * @param string $url       The image URL.
     * @param array  $upload_dir Result of wp_upload_dir().
     * @return string|null Local path or null.
     */
    private function url_to_local_path( $url, $upload_dir ) {
        // Try replacing the upload URL with the upload path
        if ( strpos( $url, $upload_dir['baseurl'] ) === 0 ) {
            return str_replace( $upload_dir['baseurl'], $upload_dir['basedir'], $url );
        }

        // Fallback: try ABSPATH
        $parsed = parse_url( $url );
        if ( isset( $parsed['path'] ) ) {
            $local = ABSPATH . ltrim( $parsed['path'], '/' );
            if ( file_exists( $local ) ) {
                return $local;
            }
        }

        return null;
    }
}
