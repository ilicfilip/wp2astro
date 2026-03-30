/**
 * Minimal classic WordPress theme for Playground preview only.
 * Keeps nav menus under Appearance → Menus and avoids block-theme admin noise.
 * Not the Astro front-end — footer reminds authors of that.
 */

export const WP2ASTRO_PREVIEW_THEME_SLUG = 'wp2astro-preview';

/** Absolute virtual paths inside Playground (document root = /wordpress). */
export function getWp2AstroPreviewThemeDir() {
  return `/wordpress/wp-content/themes/${WP2ASTRO_PREVIEW_THEME_SLUG}`;
}

/**
 * @returns {Record<string, string>} path → file contents for Blueprint writeFile steps
 */
export function getWp2AstroPreviewThemeFiles() {
  const base = getWp2AstroPreviewThemeDir();

  return {
    [`${base}/style.css`]: `/*
Theme Name: WP2Astro Preview
Description: Minimal classic theme for the in-browser WordPress preview. The static site is built separately (Astro).
Version: 1.0.0
Requires at least: 6.0
Tested up to: 6.8
Author: WP2Astro
Text Domain: wp2astro-preview
*/

:root {
  --wp2astro-bg: #f6f4ef;
  --wp2astro-ink: #1c1b19;
  --wp2astro-muted: #5c5a57;
  --wp2astro-accent: #2c6b5a;
  --wp2astro-border: #e0dcd4;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--wp2astro-ink);
  background: var(--wp2astro-bg);
}

a { color: var(--wp2astro-accent); }
a:hover { text-decoration: underline; }

.site-header {
  background: #fff;
  border-bottom: 1px solid var(--wp2astro-border);
  padding: 1rem 1.5rem 1.25rem;
}

.site-branding .site-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
}
.site-branding .site-title a { text-decoration: none; color: var(--wp2astro-ink); }
.site-branding .site-title a:hover { color: var(--wp2astro-accent); }

.site-description {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  color: var(--wp2astro-muted);
}

.main-navigation {
  margin-top: 1rem;
}
.primary-menu {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}
.primary-menu a {
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
}

.site-main {
  max-width: 42rem;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
}

.entry-title { margin-top: 0; font-size: 1.5rem; }
.entry-content :where(p, ul, ol) { margin-bottom: 1rem; }

.site-footer {
  border-top: 1px solid var(--wp2astro-border);
  padding: 1rem 1.5rem 2rem;
  font-size: 0.8rem;
  color: var(--wp2astro-muted);
  text-align: center;
  background: #fff;
}
.preview-notice { margin: 0; max-width: 36rem; margin-inline: auto; }
`,

    [`${base}/functions.php`]: `<?php
/**
 * WP2Astro Preview — minimal classic theme for Playground only.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function wp2astro_preview_setup() {
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support(
		'html5',
		array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' )
	);

	register_nav_menus(
		array(
			'primary' => __( 'Primary Menu', 'wp2astro-preview' ),
		)
	);
}
add_action( 'after_setup_theme', 'wp2astro_preview_setup' );

function wp2astro_preview_enqueue_styles() {
	wp_enqueue_style(
		'wp2astro-preview-style',
		get_stylesheet_uri(),
		array(),
		wp_get_theme()->get( 'Version' )
	);
}
add_action( 'wp_enqueue_scripts', 'wp2astro_preview_enqueue_styles' );
`,

    [`${base}/header.php`]: `<?php
/**
 * Theme header.
 */
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<header class="site-header">
	<div class="site-branding">
		<h1 class="site-title"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php bloginfo( 'name' ); ?></a></h1>
		<?php if ( get_bloginfo( 'description', 'display' ) ) : ?>
			<p class="site-description"><?php bloginfo( 'description' ); ?></p>
		<?php endif; ?>
	</div>
	<nav class="main-navigation" aria-label="<?php esc_attr_e( 'Primary', 'wp2astro-preview' ); ?>">
		<?php
		wp_nav_menu(
			array(
				'theme_location' => 'primary',
				'menu_class'     => 'primary-menu',
				'container'      => false,
				'fallback_cb'    => false,
			)
		);
		?>
	</nav>
</header>
<main id="primary" class="site-main">
`,

    [`${base}/footer.php`]: `<?php
/**
 * Theme footer.
 */
?>
</main>
<footer class="site-footer">
	<p class="preview-notice"><?php esc_html_e( 'WordPress preview only — the public site is built with Astro after you sync.', 'wp2astro-preview' ); ?></p>
	<?php wp_footer(); ?>
</body>
</html>
`,

    [`${base}/index.php`]: `<?php
/**
 * Main template — blog index and fallbacks.
 */
get_header();
if ( have_posts() ) :
	while ( have_posts() ) :
		the_post();
		?>
		<article <?php post_class(); ?>>
			<h2 class="entry-title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
			<div class="entry-summary"><?php the_excerpt(); ?></div>
		</article>
		<?php
	endwhile;
	the_posts_pagination();
else :
	?>
	<p><?php esc_html_e( 'No posts yet.', 'wp2astro-preview' ); ?></p>
	<?php
endif;
get_footer();
`,

    [`${base}/single.php`]: `<?php
/**
 * Single post.
 */
get_header();
while ( have_posts() ) :
	the_post();
	?>
	<article <?php post_class(); ?>>
		<h1 class="entry-title"><?php the_title(); ?></h1>
		<div class="entry-content"><?php the_content(); ?></div>
	</article>
	<?php
endwhile;
get_footer();
`,

    [`${base}/page.php`]: `<?php
/**
 * Page template.
 */
get_header();
while ( have_posts() ) :
	the_post();
	?>
	<article <?php post_class(); ?>>
		<h1 class="entry-title"><?php the_title(); ?></h1>
		<div class="entry-content"><?php the_content(); ?></div>
	</article>
	<?php
endwhile;
get_footer();
`,
  };
}
