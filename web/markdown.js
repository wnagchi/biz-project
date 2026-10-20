(() => {
  let sequence = 0;
  const text = value => document.createTextNode(String(value ?? ''));
  function node(tag, ...children) {
    const element = document.createElement(tag);
    element.append(...children.flat());
    return element;
  }
  function decode(value) {
    // Decode entities as text; literal angle brackets never reach the HTML parser.
    const escaped = String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return new DOMParser().parseFromString(`<!doctype html><body>${escaped}`, 'text/html').body.textContent;
  }
  function safeLink(value) {
    const href = decode(value).trim();
    if (/[\u0000-\u0020\u007f]/.test(href)) return null;
    if (href.startsWith('#')) return href;
    try { return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol) ? href : null; }
    catch { return null; }
  }
  function render(content) {
    const root = node('article'); root.className = 'markdown-body';
    const prefix = `biz-md-${++sequence}`, headings = new Map();
    const children = (tokens, depth = 0) => {
      if (depth > 128) return [text(tokens.map(token => token.raw || token.text || '').join(''))];
      return tokens.flatMap(token => {
        const nested = () => children(token.tokens || [], depth + 1);
        switch (token.type) {
          case 'space': case 'def': return [];
          case 'heading': {
            const heading = node(`h${Math.min(6, Math.max(1, token.depth))}`, ...nested());
            const slug = heading.textContent.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
            let key = slug, suffix = 0;
            while (headings.has(key)) key = `${slug}-${++suffix}`;
            heading.id = `${prefix}-${key}`; headings.set(key, heading); return [heading];
          }
          case 'paragraph': return [node('p', ...nested())];
          case 'blockquote': return [node('blockquote', ...nested())];
          case 'hr': return [node('hr')];
          case 'br': return [node('br')];
          case 'strong': case 'em': case 'del': return [node(token.type, ...nested())];
          case 'code': case 'codespan': {
            const code = node('code', text(token.text));
            if (token.type === 'codespan') return [code];
            const block = node('pre', code);
            if (token.lang) block.setAttribute('aria-label', String(token.lang));
            return [block];
          }
          case 'list': {
            const list = node(token.ordered ? 'ol' : 'ul');
            if (token.ordered && Number.isSafeInteger(Number(token.start))) list.start = Number(token.start);
            for (const item of token.items) {
              const li = node('li', ...children(item.tokens, depth + 1));
              if (item.task) li.className = 'task-list-item';
              list.append(li);
            }
            return [list];
          }
          case 'checkbox': {
            const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = token.checked; checkbox.disabled = true;
            checkbox.setAttribute('aria-label', '任务状态'); return [checkbox, text(' ')];
          }
          case 'table': {
            const row = (cells, tag) => node('tr', ...cells.map((cell, index) => {
              const td = node(tag, ...children(cell.tokens, depth + 1));
              if (['left', 'center', 'right'].includes(token.align[index])) td.className = `align-${token.align[index]}`;
              return td;
            }));
            const table = node('table', node('thead', row(token.header, 'th')), node('tbody', ...token.rows.map(cells => row(cells, 'td'))));
            const wrapper = node('div', table); wrapper.className = 'markdown-table'; wrapper.tabIndex = 0;
            wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'Markdown 表格'); return [wrapper];
          }
          case 'link': case 'image': {
            const label = token.type === 'image' ? [text(decode(token.text) || '图片')] : nested();
            const href = safeLink(token.href);
            const link = node(href ? 'a' : 'span', ...label);
            if (token.title) link.title = decode(token.title);
            if (token.type === 'image') link.className = 'markdown-image-label';
            if (href) {
              link.setAttribute('href', href);
              if (href.startsWith('#')) link.addEventListener('click', event => {
                event.preventDefault();
                let key; try { key = decodeURIComponent(href.slice(1)); } catch { return; }
                const heading = headings.get(key), container = heading?.closest('.pane-scroll,.history-markdown,dialog');
                if (container) container.scrollTop += heading.getBoundingClientRect().top - container.getBoundingClientRect().top;
              });
              else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
            }
            return [link];
          }
          case 'text': return token.tokens ? nested() : [text(decode(token.text))];
          case 'escape': return [text(token.text)];
          case 'html': return [text(token.raw || token.text)];
          default: return [text(token.raw || token.text)];
        }
      });
    };
    try { root.append(...children(window.marked.lexer(content || '暂无记录', { gfm: true }))); }
    catch { root.append(node('pre', text(content || '暂无记录'))); }
    return root;
  }
  window.BizMarkdown = { render };
})();
