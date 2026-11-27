import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderReportText } from '../src/report-text.js';

test('Report renders its supported Markdown and preserves unsupported syntax as text', () => {
  const { document } = new JSDOM('<div></div>').window;
  const report = document.querySelector('div');
  renderReportText(report, [
    '### Developer DRAFT',
    '#### Evidence',
    '* **Validator:** `r17`',
    '* Reproduced on Row 3',
    '',
    '```csv',
    'customer_id,name',
    'SYN-002,**literal**',
    '```',
    '',
    '2. Confirm the rule',
    '3. Run the sample again',
    '',
    '> [Unsupported link](https://example.test) and *italic*',
    '',
    '```',
    '**Unclosed fence**'
  ].join('\n'));

  assert.equal(report.querySelector('h4').textContent, 'Developer DRAFT');
  assert.equal(report.querySelector('h5').textContent, 'Evidence');
  assert.equal(report.querySelector('ul li strong').textContent, 'Validator:');
  assert.equal(report.querySelector('ul li code').textContent, 'r17');
  assert.equal(report.querySelectorAll('ul li').length, 2);
  assert.equal(report.querySelector('pre code').textContent, 'customer_id,name\nSYN-002,**literal**');
  assert.equal(report.querySelector('ol').start, 2);
  assert.equal(report.querySelectorAll('ol li').length, 2);
  assert.equal(report.querySelector('p').textContent, '> [Unsupported link](https://example.test) and *italic*');
  assert.equal(report.lastElementChild.textContent, '```\n**Unclosed fence**');
});

test('Report never turns model HTML into elements even inside supported Markdown', () => {
  const { document } = new JSDOM('<div></div>').window;
  const report = document.querySelector('div');
  const script = '<script>alert(1)</script>';
  const image = '<img src=x onerror="alert(1)">';
  renderReportText(report, [
    script,
    `### ${image}`,
    `- **${script}**`,
    `- \`${image}\``,
    '```html',
    `${script}${image}`,
    '```'
  ].join('\n'));

  assert.equal(report.querySelector('script,img,[onerror]'), null);
  assert.equal(report.querySelector('p').textContent, script);
  assert.equal(report.querySelector('h4').textContent, image);
  assert.equal(report.querySelector('li strong').textContent, script);
  assert.equal(report.querySelector('li code').textContent, image);
  assert.equal(report.querySelector('pre code').textContent, script + image);
});
