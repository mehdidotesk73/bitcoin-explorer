/**
 * Tiny, dependency-free Markdown → HTML renderer covering the subset used by the
 * in-app help docs (`docs/concepts/*.md`): headings, paragraphs, fenced code,
 * inline code, bold / italic, links, horizontal rules, and nested bullet lists.
 *
 * Content is HTML-escaped first, so it is safe to inject the result with v-html
 * for our own trusted docs. It is intentionally small, not a spec-complete
 * Markdown engine.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inline spans on an already HTML-escaped string. */
function inline(s: string): string {
  // `code` first so its contents are not further formatted.
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
  // [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`,
  )
  // **bold** then *italic* / _italic_
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>')
  return s
}

interface ListItem {
  indent: number
  ordered: boolean
  text: string
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  const listRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block.
    if (/^\s*```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    // Blank line.
    if (/^\s*$/.test(line)) {
      i++
      continue
    }

    // Horizontal rule.
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr />')
      i++
      continue
    }

    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      out.push(`<h${level}>${inline(escapeHtml(h[2]))}</h${level}>`)
      i++
      continue
    }

    // List (group consecutive list lines).
    if (listRe.test(line)) {
      const items: ListItem[] = []
      while (i < lines.length && listRe.test(lines[i])) {
        const m = lines[i].match(listRe)!
        items.push({
          indent: m[1].length,
          ordered: /\d+\./.test(m[2]),
          text: inline(escapeHtml(m[3])),
        })
        i++
      }
      out.push(renderList(items))
      continue
    }

    // Paragraph (gather consecutive non-block lines).
    const para: string[] = []
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !listRe.test(lines[i])
    ) {
      para.push(lines[i].trim())
      i++
    }
    out.push(`<p>${inline(escapeHtml(para.join(' ')))}</p>`)
  }

  return out.join('\n')
}

/** Build (possibly nested) <ul>/<ol>; items already carry inlined text. */
function renderList(items: ListItem[]): string {
  let i = 0
  function level(indent: number): string {
    const tag = items[i].ordered ? 'ol' : 'ul'
    let out = `<${tag}>`
    while (i < items.length && items[i].indent >= indent) {
      if (items[i].indent > indent) break
      out += `<li>${items[i].text}`
      i++
      if (i < items.length && items[i].indent > indent) out += level(items[i].indent)
      out += '</li>'
    }
    return out + `</${tag}>`
  }
  return level(items[0].indent)
}
