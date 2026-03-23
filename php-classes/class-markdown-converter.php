<?php
/**
 * Converts WordPress HTML (rendered Gutenberg output) to Markdown.
 *
 * This is a self-contained converter — no Composer dependencies.
 * It handles the HTML elements that WordPress/Gutenberg actually produces.
 *
 * Processing order matters: block-level elements first, then inline.
 */
class Astro_Markdown_Converter {

    /**
     * Convert HTML string to Markdown.
     *
     * @param string $html Rendered HTML from apply_filters('the_content', ...).
     * @return string Clean Markdown content.
     */
    public static function convert( $html ) {
        // Rewrite internal WP Playground URLs to relative paths before conversion.
        // WP Playground runs on 127.0.0.1 with a random port — those links
        // need to become relative so they work on the Astro site.
        $site_url = site_url();
        $html = str_replace( $site_url, '', $html );
        $md = $html;

        // ── Step 1: Pre-process ─────────────────────────────────
        // Remove Gutenberg block comments
        $md = preg_replace( '/<!--\s*\/?wp:[^>]*-->/s', '', $md );

        // Normalize line breaks
        $md = str_replace( [ "\r\n", "\r" ], "\n", $md );

        // ── Step 2: Block-level elements ────────────────────────

        // Code blocks: <pre><code>...</code></pre>
        $md = preg_replace_callback(
            '/<pre[^>]*>\s*<code(?:\s+class="language-([^"]*)")?[^>]*>(.*?)<\/code>\s*<\/pre>/si',
            function( $m ) {
                $lang = ! empty( $m[1] ) ? $m[1] : '';
                $code = html_entity_decode( $m[2], ENT_QUOTES | ENT_HTML5, 'UTF-8' );
                $code = trim( $code );
                return "\n\n```$lang\n$code\n```\n\n";
            },
            $md
        );

        // Headings: <h1> through <h6>
        for ( $i = 6; $i >= 1; $i-- ) {
            $prefix = str_repeat( '#', $i );
            $md = preg_replace_callback(
                "/<h{$i}[^>]*>(.*?)<\/h{$i}>/si",
                function( $m ) use ( $prefix ) {
                    $text = trim( strip_tags( $m[1] ) );
                    return "\n\n$prefix $text\n\n";
                },
                $md
            );
        }

        // Blockquotes: <blockquote>
        $md = preg_replace_callback(
            '/<blockquote[^>]*>(.*?)<\/blockquote>/si',
            function( $m ) {
                $inner = trim( strip_tags( $m[1] ) );
                $lines = explode( "\n", $inner );
                $quoted = array_map( function( $line ) {
                    return '> ' . trim( $line );
                }, $lines );
                return "\n\n" . implode( "\n", $quoted ) . "\n\n";
            },
            $md
        );

        // Horizontal rules
        $md = preg_replace( '/<hr[^>]*\/?>/i', "\n\n---\n\n", $md );

        // Tables
        $md = preg_replace_callback(
            '/<table[^>]*>(.*?)<\/table>/si',
            [ __CLASS__, 'convert_table' ],
            $md
        );

        // Unordered lists
        $md = preg_replace_callback(
            '/<ul[^>]*>(.*?)<\/ul>/si',
            function( $m ) {
                return "\n\n" . self::convert_list_items( $m[1], '-' ) . "\n\n";
            },
            $md
        );

        // Ordered lists
        $md = preg_replace_callback(
            '/<ol[^>]*>(.*?)<\/ol>/si',
            function( $m ) {
                return "\n\n" . self::convert_list_items( $m[1], '1.' ) . "\n\n";
            },
            $md
        );

        // Figures with images
        $md = preg_replace_callback(
            '/<figure[^>]*>.*?<img[^>]*src="([^"]*)"[^>]*(?:alt="([^"]*)")?[^>]*\/?>.*?(?:<figcaption[^>]*>(.*?)<\/figcaption>)?.*?<\/figure>/si',
            function( $m ) {
                $src     = $m[1];
                $alt     = isset( $m[2] ) ? $m[2] : '';
                $caption = isset( $m[3] ) ? trim( strip_tags( $m[3] ) ) : '';
                $result  = "\n\n![$alt]($src)";
                if ( $caption ) {
                    $result .= "\n*$caption*";
                }
                return $result . "\n\n";
            },
            $md
        );

        // Paragraphs
        $md = preg_replace_callback(
            '/<p[^>]*>(.*?)<\/p>/si',
            function( $m ) {
                $inner = trim( $m[1] );
                if ( empty( $inner ) ) return '';
                return "\n\n" . $inner . "\n\n";
            },
            $md
        );

        // ── Step 3: Inline elements ─────────────────────────────

        // Images (standalone, not in figures)
        $md = preg_replace_callback(
            '/<img[^>]*src="([^"]*)"[^>]*(?:alt="([^"]*)")?[^>]*\/?>/si',
            function( $m ) {
                $src = $m[1];
                $alt = isset( $m[2] ) ? $m[2] : '';
                return "![$alt]($src)";
            },
            $md
        );

        // Links
        $md = preg_replace_callback(
            '/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/si',
            function( $m ) {
                $href = $m[1];
                $text = trim( $m[2] );
                // If the link wraps an image, don't double-bracket
                if ( strpos( $text, '![' ) === 0 ) {
                    return $text;
                }
                return "[$text]($href)";
            },
            $md
        );

        // Bold: <strong>, <b>
        $md = preg_replace( '/<(?:strong|b)[^>]*>(.*?)<\/(?:strong|b)>/si', '**$1**', $md );

        // Italic: <em>, <i>
        $md = preg_replace( '/<(?:em|i)[^>]*>(.*?)<\/(?:em|i)>/si', '*$1*', $md );

        // Strikethrough: <del>, <s>
        $md = preg_replace( '/<(?:del|s)[^>]*>(.*?)<\/(?:del|s)>/si', '~~$1~~', $md );

        // Inline code: <code> (not inside <pre>)
        $md = preg_replace( '/<code[^>]*>(.*?)<\/code>/si', '`$1`', $md );

        // Line breaks
        $md = preg_replace( '/<br\s*\/?>/i', "  \n", $md );

        // ── Step 4: Post-process ────────────────────────────────

        // Strip any remaining HTML tags
        $md = strip_tags( $md );

        // Decode HTML entities
        $md = html_entity_decode( $md, ENT_QUOTES | ENT_HTML5, 'UTF-8' );

        // Normalize Unicode × (U+00D7) to ASCII x in image paths.
        // WordPress uses × in dimension strings like "1024×693" but the
        // actual files on disk use ASCII x. Fix it in image references.
        $md = preg_replace_callback(
            '/!\[([^\]]*)\]\(([^)]+)\)/',
            function( $m ) {
                $alt = $m[1];
                $src = str_replace( '×', 'x', $m[2] );
                return "![$alt]($src)";
            },
            $md
        );

        // Collapse 3+ consecutive newlines into 2
        $md = preg_replace( '/\n{3,}/', "\n\n", $md );

        // Trim
        $md = trim( $md );

        return $md;
    }

    /**
     * Convert <li> items within a list.
     */
    private static function convert_list_items( $html, $marker ) {
        $items = [];
        preg_match_all( '/<li[^>]*>(.*?)<\/li>/si', $html, $matches );

        $counter = 1;
        foreach ( $matches[1] as $item ) {
            $text = trim( strip_tags( $item ) );
            if ( $marker === '1.' ) {
                $items[] = "$counter. $text";
                $counter++;
            } else {
                $items[] = "$marker $text";
            }
        }

        return implode( "\n", $items );
    }

    /**
     * Convert an HTML table to GFM Markdown table.
     */
    private static function convert_table( $matches ) {
        $html  = $matches[1];
        $rows  = [];
        $is_first = true;

        // Extract rows
        preg_match_all( '/<tr[^>]*>(.*?)<\/tr>/si', $html, $tr_matches );

        foreach ( $tr_matches[1] as $tr ) {
            $cells = [];
            // Match both th and td
            preg_match_all( '/<(?:th|td)[^>]*>(.*?)<\/(?:th|td)>/si', $tr, $cell_matches );
            foreach ( $cell_matches[1] as $cell ) {
                $cells[] = trim( strip_tags( $cell ) );
            }
            $rows[] = $cells;
        }

        if ( empty( $rows ) ) return '';

        // Build markdown table
        $output = "\n\n";
        $col_count = count( $rows[0] );

        // Header row
        $output .= '| ' . implode( ' | ', $rows[0] ) . " |\n";
        $output .= '| ' . implode( ' | ', array_fill( 0, $col_count, '---' ) ) . " |\n";

        // Data rows
        for ( $i = 1; $i < count( $rows ); $i++ ) {
            // Pad row if needed
            while ( count( $rows[$i] ) < $col_count ) {
                $rows[$i][] = '';
            }
            $output .= '| ' . implode( ' | ', $rows[$i] ) . " |\n";
        }

        return $output . "\n";
    }
}
