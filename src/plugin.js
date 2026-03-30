/**
 * WP Astro Exporter plugin PHP code as strings.
 *
 * These get loaded into WP Playground via Blueprint writeFile steps.
 * The browser version adds REST API endpoints so the SPA can fetch
 * exported content directly (instead of writing to filesystem).
 *
 * The plugin is split into multiple files for clarity, but could be
 * combined into one if needed.
 */

/**
 * Main plugin entry point.
 * Defines constants, includes files, registers REST API routes.
 */
export const mainPlugin = `<?php
/**
 * Plugin Name: WP Astro Exporter (Browser)
 * Description: Exports WordPress posts/pages as Markdown with frontmatter. Browser version with REST API.
 * Version: 2.0.0
 * Author: Astro WP
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// Export directories inside the virtual filesystem
define( 'ASTRO_EXPORT_DIR', WP_CONTENT_DIR . '/astro-content/blog/' );
define( 'ASTRO_PAGES_EXPORT_DIR', WP_CONTENT_DIR . '/astro-content/pages/' );
define( 'ASTRO_IMAGES_DIR', WP_CONTENT_DIR . '/astro-images/' );
define( 'ASTRO_IMAGES_URL_PREFIX', '/assets/images/' );

// Ensure directories exist
foreach ( [ ASTRO_EXPORT_DIR, ASTRO_PAGES_EXPORT_DIR, ASTRO_IMAGES_DIR ] as $dir ) {
    if ( ! is_dir( $dir ) ) {
        mkdir( $dir, 0755, true );
    }
}

// Include component files
require_once __DIR__ . '/includes/class-markdown-converter.php';
require_once __DIR__ . '/includes/class-frontmatter-builder.php';
require_once __DIR__ . '/includes/class-image-handler.php';
require_once __DIR__ . '/includes/class-post-exporter.php';
require_once __DIR__ . '/includes/class-md-to-blocks.php';
require_once __DIR__ . '/includes/class-md-importer.php';
require_once __DIR__ . '/includes/class-rest-api.php';

// Initialize
add_action( 'plugins_loaded', function() {
    new Astro_Post_Exporter();
});

// Register REST API routes
add_action( 'rest_api_init', function() {
    Astro_REST_API::register_routes();
});
`;

/**
 * REST API class — the key addition for the browser version.
 * Exposes endpoints to fetch exported content from the SPA.
 */
export const restApiClass = `<?php
/**
 * REST API endpoints for the browser-based Astro WP app.
 *
 * Endpoints:
 *   GET /astro-export/v1/posts       → All published/draft posts as markdown
 *   GET /astro-export/v1/pages       → All published/draft pages as markdown
 *   GET /astro-export/v1/post/{id}   → Single post as markdown
 *   GET /astro-export/v1/page/{id}   → Single page as markdown
 *   GET /astro-export/v1/images      → List of exported images with base64 data
 *   GET /astro-export/v1/manifest    → Slugs + hashes for change detection
 *   GET /astro-export/v1/menu        → Nav menus by theme location (for Astro)
 */
class Astro_REST_API {

    public static function register_routes() {
        $ns = 'astro-export/v1';

        register_rest_route( $ns, '/menu', [
            'methods'  => 'GET',
            'callback' => [ __CLASS__, 'get_menu' ],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route( $ns, '/posts', [
            'methods'  => 'GET',
            'callback' => [ __CLASS__, 'get_posts' ],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route( $ns, '/pages', [
            'methods'  => 'GET',
            'callback' => [ __CLASS__, 'get_pages' ],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route( $ns, '/post/(?P<id>\\d+)', [
            'methods'  => 'GET',
            'callback' => [ __CLASS__, 'get_single_post' ],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route( $ns, '/page/(?P<id>\\d+)', [
            'methods'  => 'GET',
            'callback' => [ __CLASS__, 'get_single_page' ],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route( $ns, '/images', [
            'methods'  => 'GET',
            'callback' => [ __CLASS__, 'get_images' ],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route( $ns, '/manifest', [
            'methods'  => 'GET',
            'callback' => [ __CLASS__, 'get_manifest' ],
            'permission_callback' => '__return_true',
        ]);
    }

    /**
     * Build hierarchical menu + hash for src/data/menu.json.
     */
    private static function build_menu_export() {
        $locations_out = [];
        $assigned = get_nav_menu_locations();

        if ( is_array( $assigned ) ) {
            foreach ( $assigned as $location => $menu_id ) {
                if ( ! $menu_id ) {
                    continue;
                }
                $items = wp_get_nav_menu_items( $menu_id );
                $locations_out[ $location ] = $items ? self::build_menu_tree( $items, 0 ) : [];
            }
        }

        if ( empty( $locations_out ) ) {
            $menus = wp_get_nav_menus();
            if ( ! empty( $menus ) ) {
                $items = wp_get_nav_menu_items( $menus[0]->term_id );
                $locations_out['primary'] = $items ? self::build_menu_tree( $items, 0 ) : [];
            } else {
                $locations_out['primary'] = [];
            }
        }

        $export = [ 'locations' => $locations_out ];
        $json   = wp_json_encode( $export, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );

        return [
            'locations' => $locations_out,
            'hash'      => md5( $json ),
        ];
    }

    /**
     * @param array $items Flat list from wp_get_nav_menu_items.
     * @param int   $parent_id Parent menu item ID (0 = top level).
     */
    private static function build_menu_tree( $items, $parent_id ) {
        $branch = [];

        foreach ( $items as $item ) {
            if ( (int) $item->menu_item_parent !== (int) $parent_id ) {
                continue;
            }

            $entry = [
                'label' => $item->title,
                'href'  => self::normalize_menu_url( $item->url ),
            ];

            if ( ! empty( $item->target ) ) {
                $entry['target'] = $item->target;
            }
            if ( ! empty( $item->attr_title ) ) {
                $entry['title'] = $item->attr_title;
            }

            $children = self::build_menu_tree( $items, (int) $item->ID );
            if ( ! empty( $children ) ) {
                $entry['children'] = $children;
            }

            $branch[] = $entry;
        }

        return $branch;
    }

    /**
     * Internal URLs become path-only (with trailing slash). External links unchanged.
     */
    private static function normalize_menu_url( $url ) {
        if ( empty( $url ) || $url === '#' ) {
            return '#';
        }

        $url = trim( $url );

        if ( strpos( $url, 'http' ) !== 0 && strpos( $url, '//' ) !== 0 ) {
            $path = $url[0] === '/' ? $url : '/' . $url;
            $path = self::strip_playground_scope( $path );
            return $path === '/' ? '/' : trailingslashit( $path );
        }

        $site   = wp_parse_url( home_url() );
        $parsed = wp_parse_url( $url );

        if ( ! empty( $parsed['host'] ) && ! empty( $site['host'] )
            && strtolower( $parsed['host'] ) === strtolower( $site['host'] ) ) {
            $path = isset( $parsed['path'] ) ? $parsed['path'] : '/';
            $path = '/' . trim( $path, '/' );
            $path = self::strip_playground_scope( $path );
            if ( $path === '/' ) {
                return '/';
            }
            return trailingslashit( $path );
        }

        return $url;
    }

    /**
     * Strip WP Playground scope prefix (e.g. /scope:0.123456/) from paths.
     */
    private static function strip_playground_scope( $path ) {
        return preg_replace( '#^/scope:[0-9.]+#', '', $path ) ?: '/';
    }

    public static function get_menu() {
        return self::build_menu_export();
    }

    /**
     * Export a single WP_Post to markdown string.
     */
    private static function export_to_markdown( $post ) {
        $image_handler = new Astro_Image_Handler();
        $hero_image    = $image_handler->process_featured_image( $post );
        $content_html  = apply_filters( 'the_content', $post->post_content );
        $content_html  = $image_handler->process_inline_images( $content_html );

        $frontmatter   = Astro_Frontmatter_Builder::build( $post, $hero_image );
        $markdown_body = Astro_Markdown_Converter::convert( $content_html );

        return "---\\n" . $frontmatter . "---\\n\\n" . $markdown_body . "\\n";
    }

    /**
     * Build export data for a post/page.
     */
    private static function build_export_item( $post ) {
        $slug = $post->post_name;
        if ( empty( $slug ) ) {
            $slug = sanitize_title( $post->post_title );
            if ( empty( $slug ) ) {
                $slug = 'draft-' . $post->ID;
            }
        }

        $markdown = self::export_to_markdown( $post );

        return [
            'id'       => $post->ID,
            'slug'     => $slug,
            'filename' => sanitize_file_name( $slug ) . '.md',
            'markdown' => $markdown,
            'hash'     => md5( $markdown ),
        ];
    }

    public static function get_posts() {
        $posts = get_posts([
            'post_type'      => 'post',
            'post_status'    => [ 'publish', 'draft' ],
            'posts_per_page' => -1,
        ]);

        return array_map( [ __CLASS__, 'build_export_item' ], $posts );
    }

    public static function get_pages() {
        $pages = get_posts([
            'post_type'      => 'page',
            'post_status'    => [ 'publish', 'draft' ],
            'posts_per_page' => -1,
        ]);

        return array_map( [ __CLASS__, 'build_export_item' ], $pages );
    }

    public static function get_single_post( $request ) {
        $post = get_post( intval( $request['id'] ) );
        if ( ! $post || $post->post_type !== 'post' ) {
            return new WP_Error( 'not_found', 'Post not found', [ 'status' => 404 ] );
        }
        return self::build_export_item( $post );
    }

    public static function get_single_page( $request ) {
        $post = get_post( intval( $request['id'] ) );
        if ( ! $post || $post->post_type !== 'page' ) {
            return new WP_Error( 'not_found', 'Page not found', [ 'status' => 404 ] );
        }
        return self::build_export_item( $post );
    }

    /**
     * Return all images in the astro-images directory as base64.
     */
    public static function get_images() {
        $images = [];

        if ( ! is_dir( ASTRO_IMAGES_DIR ) ) {
            return $images;
        }

        $files = glob( ASTRO_IMAGES_DIR . '*' );
        foreach ( $files as $file ) {
            if ( is_file( $file ) ) {
                $filename = basename( $file );
                $mime_map = [
                    'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
                    'png' => 'image/png', 'gif' => 'image/gif',
                    'webp' => 'image/webp', 'svg' => 'image/svg+xml',
                    'avif' => 'image/avif',
                ];
                $ext  = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
                $mime = $mime_map[ $ext ] ?? 'application/octet-stream';

                $images[] = [
                    'filename' => $filename,
                    'path'     => 'public/assets/images/' . $filename,
                    'mime'     => $mime,
                    'base64'   => base64_encode( file_get_contents( $file ) ),
                    'hash'     => md5_file( $file ),
                ];
            }
        }

        return $images;
    }

    /**
     * Return a manifest of all content for change detection.
     * The SPA uses this to determine what needs syncing.
     */
    public static function get_manifest() {
        $manifest = [];

        $posts = get_posts([
            'post_type'      => [ 'post', 'page' ],
            'post_status'    => [ 'publish', 'draft' ],
            'posts_per_page' => -1,
        ]);

        foreach ( $posts as $post ) {
            $item = self::build_export_item( $post );
            $dir  = $post->post_type === 'page' ? 'pages' : 'blog';
            $manifest[ 'src/content/' . $dir . '/' . $item['filename'] ] = $item['hash'];
        }

        // Add image hashes
        if ( is_dir( ASTRO_IMAGES_DIR ) ) {
            $files = glob( ASTRO_IMAGES_DIR . '*' );
            foreach ( $files as $file ) {
                if ( is_file( $file ) ) {
                    $manifest[ 'public/assets/images/' . basename( $file ) ] = md5_file( $file );
                }
            }
        }

        $menu = self::build_menu_export();
        $manifest['src/data/menu.json'] = $menu['hash'];

        return $manifest;
    }
}
`;

/**
 * Get all plugin files as a map of virtual path → content.
 * Used in the Blueprint writeFile steps.
 */
export function getPluginFiles() {
  const pluginDir = '/wordpress/wp-content/plugins/wp-astro-exporter';

  return {
    [`${pluginDir}/wp-astro-exporter.php`]: mainPlugin,
    [`${pluginDir}/includes/class-rest-api.php`]: restApiClass,
    // The following are reused from the CLI version (loaded at runtime)
  };
}
