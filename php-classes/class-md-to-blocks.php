<?php
/**
 * Converts Markdown content to WordPress Gutenberg block markup.
 *
 * Produces valid block HTML that Gutenberg can parse and edit natively.
 * Each Markdown element becomes a proper Gutenberg block comment + HTML.
 *
 * Example output:
 *   <!-- wp:paragraph -->
 *   <p>Hello world</p>
 *   <!-- /wp:paragraph -->
 */
class Astro_MD_To_Blocks {

    /**
     * Convert a Markdown string to Gutenberg block markup.
     *
     * @param string $md Raw Markdown content.
     * @return string Gutenberg block HTML.
     */
    public static function convert( $md ) {
        // Normalize line endings
        $md = str_replace( [ "\r\n", "\r" ], "\n", $md );

        // Split into lines for block-level processing
        $lines  = explode( "\n", $md );
        $blocks = [];
        $i      = 0;
        $count  = count( $lines );

        while ( $i < $count ) {
            $line = $lines[ $i ];

            // Skip empty lines
            if ( trim( $line ) === '' ) {
                $i++;
                continue;
            }

            // Fenced code block: ```
            if ( preg_match( '/^```(\w*)/', $line, $m ) ) {
                $lang = $m[1];
                $code_lines = [];
                $i++;
                while ( $i < $count && ! preg_match( '/^```\s*$/', $lines[ $i ] ) ) {
                    $code_lines[] = $lines[ $i ];
                    $i++;
                }
                $i++; // skip closing ```
                $code = htmlspecialchars( implode( "\n", $code_lines ), ENT_QUOTES, 'UTF-8' );
                if ( $lang ) {
                    $blocks[] = "<!-- wp:code -->\n<pre class=\"wp-block-code\"><code class=\"language-$lang\">$code</code></pre>\n<!-- /wp:code -->";
                } else {
                    $blocks[] = "<!-- wp:code -->\n<pre class=\"wp-block-code\"><code>$code</code></pre>\n<!-- /wp:code -->";
                }
                continue;
            }

            // Heading: # through ######
            if ( preg_match( '/^(#{1,6})\s+(.+)$/', $line, $m ) ) {
                $level = strlen( $m[1] );
                $text  = self::inline_md( trim( $m[2] ) );
                $blocks[] = "<!-- wp:heading {\"level\":$level} -->\n<h$level>$text</h$level>\n<!-- /wp:heading -->";
                $i++;
                continue;
            }

            // Horizontal rule: --- or *** or ___
            if ( preg_match( '/^(---|\*\*\*|___)\s*$/', $line ) ) {
                $blocks[] = "<!-- wp:separator -->\n<hr class=\"wp-block-separator\"/>\n<!-- /wp:separator -->";
                $i++;
                continue;
            }

            // Image: ![alt](src)
            if ( preg_match( '/^!\[([^\]]*)\]\(([^)]+)\)\s*$/', trim( $line ), $m ) ) {
                $alt = htmlspecialchars( $m[1], ENT_QUOTES, 'UTF-8' );
                $src = $m[2];
                $blocks[] = "<!-- wp:image -->\n<figure class=\"wp-block-image\"><img src=\"$src\" alt=\"$alt\"/></figure>\n<!-- /wp:image -->";
                $i++;
                continue;
            }

            // Blockquote: > lines
            if ( preg_match( '/^>\s?(.*)$/', $line, $m ) ) {
                $quote_lines = [ $m[1] ];
                $i++;
                while ( $i < $count && preg_match( '/^>\s?(.*)$/', $lines[ $i ], $m ) ) {
                    $quote_lines[] = $m[1];
                    $i++;
                }
                $text = self::inline_md( implode( "\n", $quote_lines ) );
                $blocks[] = "<!-- wp:quote -->\n<blockquote class=\"wp-block-quote\"><p>$text</p></blockquote>\n<!-- /wp:quote -->";
                continue;
            }

            // Unordered list: - item or * item
            if ( preg_match( '/^[\-\*]\s+(.+)$/', $line ) ) {
                $items = [];
                while ( $i < $count && preg_match( '/^[\-\*]\s+(.+)$/', $lines[ $i ], $m ) ) {
                    $items[] = '<li>' . self::inline_md( $m[1] ) . '</li>';
                    $i++;
                }
                $list_html = implode( "\n", $items );
                $blocks[] = "<!-- wp:list -->\n<ul class=\"wp-block-list\">\n$list_html\n</ul>\n<!-- /wp:list -->";
                continue;
            }

            // Ordered list: 1. item
            if ( preg_match( '/^\d+\.\s+(.+)$/', $line ) ) {
                $items = [];
                while ( $i < $count && preg_match( '/^\d+\.\s+(.+)$/', $lines[ $i ], $m ) ) {
                    $items[] = '<li>' . self::inline_md( $m[1] ) . '</li>';
                    $i++;
                }
                $list_html = implode( "\n", $items );
                $blocks[] = "<!-- wp:list {\"ordered\":true} -->\n<ol class=\"wp-block-list\">\n$list_html\n</ol>\n<!-- /wp:list -->";
                continue;
            }

            // Default: paragraph — collect consecutive non-empty, non-block lines
            $para_lines = [];
            while ( $i < $count && trim( $lines[ $i ] ) !== '' &&
                    ! preg_match( '/^(#{1,6}\s|```|>\s?|[\-\*]\s|\d+\.\s|---|\*\*\*|___|!\[)/', $lines[ $i ] ) ) {
                $para_lines[] = $lines[ $i ];
                $i++;
            }
            if ( ! empty( $para_lines ) ) {
                $text = self::inline_md( implode( ' ', $para_lines ) );
                $blocks[] = "<!-- wp:paragraph -->\n<p>$text</p>\n<!-- /wp:paragraph -->";
            }
        }

        return implode( "\n\n", $blocks );
    }

    /**
     * Convert inline Markdown to HTML.
     * Handles: bold, italic, strikethrough, inline code, links, inline images.
     *
     * @param string $text Markdown text with inline formatting.
     * @return string HTML text.
     */
    private static function inline_md( $text ) {
        // Inline images: ![alt](src)
        $text = preg_replace_callback(
            '/!\[([^\]]*)\]\(([^)]+)\)/',
            function( $m ) {
                $alt = htmlspecialchars( $m[1], ENT_QUOTES, 'UTF-8' );
                return '<img src="' . $m[2] . '" alt="' . $alt . '"/>';
            },
            $text
        );

        // Links: [text](url)
        $text = preg_replace_callback(
            '/\[([^\]]+)\]\(([^)]+)\)/',
            function( $m ) {
                return '<a href="' . $m[2] . '">' . $m[1] . '</a>';
            },
            $text
        );

        // Inline code: `code` (process before bold/italic to avoid conflicts)
        $text = preg_replace( '/`([^`]+)`/', '<code>$1</code>', $text );

        // Bold: **text** or __text__
        $text = preg_replace( '/\*\*(.+?)\*\*/', '<strong>$1</strong>', $text );
        $text = preg_replace( '/__(.+?)__/', '<strong>$1</strong>', $text );

        // Italic: *text* or _text_ (but not inside words with underscores)
        $text = preg_replace( '/\*([^*]+)\*/', '<em>$1</em>', $text );
        $text = preg_replace( '/(?<!\w)_([^_]+)_(?!\w)/', '<em>$1</em>', $text );

        // Strikethrough: ~~text~~
        $text = preg_replace( '/~~(.+?)~~/', '<del>$1</del>', $text );

        return $text;
    }
}
