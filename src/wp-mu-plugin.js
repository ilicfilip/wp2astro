/**
 * Must-use plugin for WordPress Playground: keep preview theme active and
 * restore Appearance → Menus (block themes remove it from the admin menu).
 */

export const WP2ASTRO_MU_PLUGIN_PATH =
  '/wordpress/wp-content/mu-plugins/wp2astro-menus.php';

export function getWp2AstroMuPluginContent(previewThemeSlug) {
  return `<?php
/**
 * Plugin Name: WP2Astro Playground Admin
 * Description: Ensures the preview theme is active and restores Appearance → Menus.
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$GLOBALS['wp2astro_preview_theme'] = '${previewThemeSlug}';

/**
 * Keep the classic preview theme active if it is installed (blueprint/switch_theme
 * may not persist the same way across Playground requests).
 */
add_action(
	'after_setup_theme',
	function () {
		$slug = $GLOBALS['wp2astro_preview_theme'];
		if ( ! $slug || ! wp_get_theme( $slug )->exists() ) {
			return;
		}
		if ( get_stylesheet() === $slug ) {
			return;
		}
		switch_theme( $slug );
	},
	0
);

/**
 * Block themes remove the classic Menus screen from Appearance; add it back
 * when it is missing so authors can manage menus for Astro export.
 */
add_action(
	'admin_menu',
	function () {
		if ( ! current_user_can( 'edit_theme_options' ) ) {
			return;
		}
		global $submenu;
		if ( isset( $submenu['themes.php'] ) && is_array( $submenu['themes.php'] ) ) {
			foreach ( $submenu['themes.php'] as $item ) {
				if ( ! empty( $item[2] ) && 'nav-menus.php' === $item[2] ) {
					return;
				}
			}
		}
		add_submenu_page(
			'themes.php',
			__( 'Menus', 'wp2astro' ),
			__( 'Menus', 'wp2astro' ),
			'edit_theme_options',
			'nav-menus.php',
			'',
			6
		);
	},
	999
);
`;
}
