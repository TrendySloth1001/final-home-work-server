/**
 * AI Response Formatter
 * Parses and structures AI responses for frontend consumption
 * Handles markdown, tables, lists, code blocks, etc.
 */

export interface FormattedContent {
  type: 'text' | 'heading' | 'list' | 'table' | 'code' | 'blockquote' | 'divider';
  content: string | string[] | Record<string, any>;
  level?: number; // For headings (1-6)
  language?: string; // For code blocks
  ordered?: boolean; // For lists
  format?: string[]; // Text formatting: ['bold', 'italic', 'code']
}

export interface FormattedResponse {
  raw: string; // Original response
  formatted: FormattedContent[]; // Structured content blocks
  hasFormatting: boolean; // Whether formatting was detected
  metadata?: {
    hasCode: boolean;
    hasTables: boolean;
    hasLists: boolean;
    wordCount: number;
  };
}

/**
 * AI Response Formatter Class
 */
class ResponseFormatter {
  /**
   * Parse and format AI response
   */
  formatResponse(rawResponse: string): FormattedResponse {
    // Validate input
    if (!rawResponse || typeof rawResponse !== 'string') {
      return {
        raw: '',
        formatted: [{ type: 'text', content: '' }],
        hasFormatting: false,
        metadata: { hasCode: false, hasTables: false, hasLists: false, wordCount: 0 },
      };
    }

    // Try to parse as JSON first (some AI models return JSON)
    let cleanResponse = rawResponse.trim();
    
    // Check if response looks like incomplete JSON (starts with { but has excessive whitespace)
    const hasExcessiveWhitespace = /\{[\s\n]{50,}/.test(cleanResponse);
    if (hasExcessiveWhitespace) {
      console.warn('[ResponseFormatter] Detected corrupted JSON response with excessive whitespace');
      // Try to clean it up
      cleanResponse = cleanResponse.replace(/\n{3,}/g, '\n\n').trim();
    }

    try {
      const jsonMatch = cleanResponse.match(/^\{[\s\S]*\}$/);
      if (jsonMatch && jsonMatch[0]) {
        const parsed = JSON.parse(jsonMatch[0]);
        // If it's a structured response, extract the main content
        const extracted = parsed.response || parsed.answer || parsed.content || parsed.explanation;
        if (extracted && typeof extracted === 'string' && extracted.trim().length > 0) {
          cleanResponse = extracted;
        }
      }
    } catch (error) {
      // JSON parsing failed, use raw response
      console.warn('[ResponseFormatter] JSON parsing failed, using raw response');
    }

    const blocks = this.parseMarkdown(cleanResponse);
    
    return {
      raw: rawResponse,
      formatted: blocks,
      hasFormatting: blocks.some(b => b.type !== 'text'),
      metadata: {
        hasCode: blocks.some(b => b.type === 'code'),
        hasTables: blocks.some(b => b.type === 'table'),
        hasLists: blocks.some(b => b.type === 'list'),
        wordCount: this.countWords(cleanResponse),
      },
    };
  }

  /**
   * Parse markdown content into structured blocks
   */
  private parseMarkdown(text: string): FormattedContent[] {
    const blocks: FormattedContent[] = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      
      // Type guard for array access
      if (!line) {
        i++;
        continue;
      }

      // Skip empty lines
      if (!line.trim()) {
        i++;
        continue;
      }

      // Code blocks (```)
      if (line.trim().startsWith('```')) {
        const result = this.parseCodeBlock(lines, i);
        blocks.push(result.block);
        i = result.nextIndex;
        continue;
      }

      // Headings (# ## ###)
      if (line.match(/^#{1,6}\s+/)) {
        blocks.push(this.parseHeading(line));
        i++;
        continue;
      }

      // Tables (| col | col |)
      if (line.includes('|') && lines[i + 1]?.includes('|')) {
        const result = this.parseTable(lines, i);
        if (result) {
          blocks.push(result.block);
          i = result.nextIndex;
          continue;
        }
      }

      // Lists (- * 1.)
      if (line.match(/^[\s]*[-*+]\s+/) || line.match(/^[\s]*\d+\.\s+/)) {
        const result = this.parseList(lines, i);
        blocks.push(result.block);
        i = result.nextIndex;
        continue;
      }

      // Blockquotes (>)
      if (line.trim().startsWith('>')) {
        const result = this.parseBlockquote(lines, i);
        blocks.push(result.block);
        i = result.nextIndex;
        continue;
      }

      // Horizontal rule (---, ***, ___)
      if (line.match(/^[\s]*(-{3,}|\*{3,}|_{3,})[\s]*$/)) {
        blocks.push({ type: 'divider', content: '' });
        i++;
        continue;
      }

      // Regular text with inline formatting
      blocks.push(this.parseText(line));
      i++;
    }

    return blocks;
  }

  /**
   * Parse code block
   */
  private parseCodeBlock(lines: string[], startIndex: number): { block: FormattedContent; nextIndex: number } {
    const firstLine = lines[startIndex];
    if (!firstLine) {
      return {
        block: { type: 'code', content: '', language: 'text' },
        nextIndex: startIndex + 1,
      };
    }
    
    const language = firstLine.trim().replace('```', '').trim() || 'text';
    const codeLines: string[] = [];
    let i = startIndex + 1;

    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }
      if (line.trim().startsWith('```')) {
        break;
      }
      codeLines.push(line);
      i++;
    }

    return {
      block: {
        type: 'code',
        content: codeLines.join('\n'),
        language,
      },
      nextIndex: i + 1,
    };
  }

  /**
   * Parse heading
   */
  private parseHeading(line: string): FormattedContent {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && match[1] && match[2]) {
      return {
        type: 'heading',
        content: match[2].trim(),
        level: match[1].length,
      };
    }
    return { type: 'text', content: line };
  }

  /**
   * Parse table with improved structure
   */
  private parseTable(lines: string[], startIndex: number): { block: FormattedContent; nextIndex: number } | null {
    const tableLines: string[] = [];
    let i = startIndex;

    // Collect all table rows
    while (i < lines.length) {
      const line = lines[i];
      if (!line || !line.includes('|')) {
        break;
      }
      tableLines.push(line);
      i++;
    }

    if (tableLines.length < 2) return null;

    const firstLine = tableLines[0];
    if (!firstLine) return null;

    // Parse table structure with better cleaning
    const headers = firstLine
      .split('|')
      .map(h => h.trim())
      .filter(h => h && h !== '' && !h.match(/^-+$/)); // Remove empty and separator cells

    // Skip separator line (second line with dashes)
    const dataLines = tableLines.slice(2);
    
    const rows = dataLines
      .map(row => {
        const cells = row.split('|')
          .map(cell => cell.trim())
          .filter(cell => cell && cell !== '');
        return cells;
      })
      .filter(row => row.length > 0); // Remove empty rows

    // Ensure all rows have the same number of columns as headers
    const normalizedRows = rows.map(row => {
      if (row.length < headers.length) {
        return [...row, ...Array(headers.length - row.length).fill('')];
      } else if (row.length > headers.length) {
        return row.slice(0, headers.length);
      }
      return row;
    });

    return {
      block: {
        type: 'table',
        content: {
          headers,
          rows: normalizedRows,
          // Add metadata for frontend rendering
          columnCount: headers.length,
          rowCount: normalizedRows.length,
          responsive: true,
        },
      },
      nextIndex: i,
    };
  }

  /**
   * Parse list
   */
  private parseList(lines: string[], startIndex: number): { block: FormattedContent; nextIndex: number } {
    const items: string[] = [];
    const firstLine = lines[startIndex];
    if (!firstLine) {
      return {
        block: { type: 'list', content: [], ordered: false },
        nextIndex: startIndex + 1,
      };
    }
    
    const isOrdered = /^\s*\d+\./.test(firstLine);
    let i = startIndex;

    const listPattern = isOrdered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;

    while (i < lines.length) {
      const line = lines[i];
      if (!line || !listPattern.test(line)) {
        break;
      }
      const item = line.replace(listPattern, '').trim();
      items.push(item);
      i++;
    }

    return {
      block: {
        type: 'list',
        content: items,
        ordered: isOrdered,
      },
      nextIndex: i,
    };
  }

  /**
   * Parse blockquote
   */
  private parseBlockquote(lines: string[], startIndex: number): { block: FormattedContent; nextIndex: number } {
    const quoteLines: string[] = [];
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];
      if (!line || !line.trim().startsWith('>')) {
        break;
      }
      quoteLines.push(line.replace(/^\s*>\s?/, '').trim());
      i++;
    }

    return {
      block: {
        type: 'blockquote',
        content: quoteLines.join(' '),
      },
      nextIndex: i,
    };
  }

  /**
   * Parse regular text with inline formatting
   */
  private parseText(line: string): FormattedContent {
    const format: string[] = [];
    let content = line;

    // Detect inline code (`code`)
    if (content.includes('`')) {
      format.push('code');
    }

    // Detect bold (**text** or __text__)
    if (content.match(/\*\*.*?\*\*/) || content.match(/__.*?__/)) {
      format.push('bold');
    }

    // Detect italic (*text* or _text_)
    if (content.match(/\*.*?\*/) || content.match(/_.*?_/)) {
      format.push('italic');
    }

    return {
      type: 'text',
      content: content.trim(),
      ...(format.length > 0 ? { format } : {}),
    };
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Extract plain text from formatted response
   */
  extractPlainText(formattedResponse: FormattedResponse): string {
    return formattedResponse.formatted
      .map(block => {
        if (typeof block.content === 'string') {
          return block.content;
        } else if (Array.isArray(block.content)) {
          return block.content.join('\n');
        } else if (typeof block.content === 'object') {
          return JSON.stringify(block.content);
        }
        return '';
      })
      .join('\n\n');
  }

  /**
   * Convert formatted response to HTML
   */
  toHTML(formattedResponse: FormattedResponse): string {
    return formattedResponse.formatted
      .map(block => this.blockToHTML(block))
      .join('\n');
  }

  /**
   * Convert single block to HTML
   */
  private blockToHTML(block: FormattedContent): string {
    switch (block.type) {
      case 'heading':
        return `<h${block.level}>${this.escapeHTML(block.content as string)}</h${block.level}>`;
      
      case 'list':
        const tag = block.ordered ? 'ol' : 'ul';
        const items = (block.content as string[])
          .map(item => `<li>${this.escapeHTML(item)}</li>`)
          .join('');
        return `<${tag}>${items}</${tag}>`;
      
      case 'table':
        const { headers, rows } = block.content as { headers: string[]; rows: string[][] };
        const headerHTML = `<thead><tr>${headers.map(h => `<th>${this.escapeHTML(h)}</th>`).join('')}</tr></thead>`;
        const bodyHTML = `<tbody>${rows.map(row => 
          `<tr>${row.map(cell => `<td>${this.escapeHTML(cell)}</td>`).join('')}</tr>`
        ).join('')}</tbody>`;
        return `<table>${headerHTML}${bodyHTML}</table>`;
      
      case 'code':
        return `<pre><code class="language-${block.language}">${this.escapeHTML(block.content as string)}</code></pre>`;
      
      case 'blockquote':
        return `<blockquote>${this.escapeHTML(block.content as string)}</blockquote>`;
      
      case 'divider':
        return '<hr>';
      
      case 'text':
        return `<p>${this.formatInlineHTML(block.content as string)}</p>`;
      
      default:
        return '';
    }
  }

  /**
   * Format inline markdown to HTML
   */
  private formatInlineHTML(text: string): string {
    let result = this.escapeHTML(text);
    
    // Bold: **text** or __text__
    result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/__(.*?)__/g, '<strong>$1</strong>');
    
    // Italic: *text* or _text_
    result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');
    result = result.replace(/_(.*?)_/g, '<em>$1</em>');
    
    // Inline code: `code`
    result = result.replace(/`(.*?)`/g, '<code>$1</code>');
    
    return result;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHTML(text: string): string {
    const div = { innerHTML: '' };
    const textNode = text;
    return textNode
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Export singleton instance
export const responseFormatter = new ResponseFormatter();
