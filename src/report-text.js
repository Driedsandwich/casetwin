function appendInline(element, text) {
  const document = element.ownerDocument;
  const appendText = value => {
    const node = document.createTextNode('');
    node.textContent = value;
    element.append(node);
  };
  let offset = 0;
  for (const match of text.matchAll(/(?<!`)`([^`\n]+)`(?!`)|(?<!\*)\*\*([^*\n]+)\*\*(?!\*)/g)) {
    appendText(text.slice(offset, match.index));
    const inline = document.createElement(match[1] ? 'code' : 'strong');
    inline.textContent = match[1] ?? match[2];
    element.append(inline);
    offset = match.index + match[0].length;
  }
  appendText(text.slice(offset));
}

export function renderReportText(container, text) {
  const document = container.ownerDocument;
  const blocks = document.createDocumentFragment();
  const lines = text.split(/\r\n?|\n/);
  let headingBase;
  let paragraph;
  let list;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const bullet = line.match(/^(?:[-+*]|(\d{1,9})\.)[ \t]+(\S.*)$/);
    if (bullet) {
      paragraph = undefined;
      const tag = bullet[1] ? 'ol' : 'ul';
      if (list?.localName !== tag) {
        list = document.createElement(tag);
        if (bullet[1]) list.start = Number(bullet[1]);
        blocks.append(list);
      }
      const item = document.createElement('li');
      if (bullet[1]) item.value = Number(bullet[1]);
      appendInline(item, bullet[2]);
      list.append(item);
      continue;
    }

    list = undefined;
    if (!line.trim()) {
      paragraph = undefined;
      continue;
    }

    const fence = line.match(/^(`{3,})(?:[\w+-]+)?[ \t]*$/);
    if (fence) {
      let end = index + 1;
      while (end < lines.length && lines[end].trimEnd() !== fence[1]) end++;
      paragraph = undefined;
      if (end === lines.length) {
        const fallback = document.createElement('p');
        fallback.textContent = lines.slice(index).join('\n');
        blocks.append(fallback);
        break;
      }
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = lines.slice(index + 1, end).join('\n');
      pre.append(code);
      blocks.append(pre);
      index = end;
      continue;
    }

    const heading = line.match(/^(#{1,6})[ \t]+(\S.*)$/);
    if (heading) {
      paragraph = undefined;
      const depth = heading[1].length;
      headingBase ??= depth;
      const title = document.createElement(`h${Math.min(4 + Math.max(0, depth - headingBase), 6)}`);
      appendInline(title, heading[2]);
      blocks.append(title);
      continue;
    }

    if (!paragraph) {
      paragraph = document.createElement('p');
      blocks.append(paragraph);
    } else {
      paragraph.append('\n');
    }
    appendInline(paragraph, line);
  }

  container.replaceChildren(blocks);
}
