import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { guideHref, guideImage, htmlImagesToMarkdown, slugger } from '@/domain/guide';
import { requireUser } from '@/server/auth';

export const metadata = { title: '사용설명서' };

/** The text inside a heading, for its id */
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : ''))
    .join('');
}

/** docs/user-guide.md, copied into public/guide/ at build (scripts/copy-guide.mjs) */
async function guide(): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), 'public/guide/user-guide.md'), 'utf8');
  } catch {
    return null;
  }
}

export default async function HelpPage() {
  await requireUser();
  const md = await guide();
  const slug = slugger();
  const heading =
    (Tag: 'h1' | 'h2' | 'h3' | 'h4') =>
    ({ children }: { children?: ReactNode }) => <Tag id={slug(textOf(children))}>{children}</Tag>;
  const components: Components = {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    a: ({ href = '', children }) => {
      const link = guideHref(href);
      return link.external ? (
        <a href={link.href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <a href={link.href}>{children}</a>
      );
    },
    // eslint-disable-next-line @next/next/no-img-element
    img: ({ src, alt, title }) => {
      const width = title?.match(/^w=(\d+)$/)?.[1];
      return <img src={guideImage(String(src ?? ''))} alt={alt ?? ''} width={width ? Number(width) : undefined} loading="lazy" />;
    },
    table: ({ children }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
  };
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>사용설명서</h1>
          <p className="sub">이 서버에 설치된 버전의 설명서입니다. 화면마다 무엇을 하는지, 언제 추가되고 바뀌었는지 적혀 있습니다.</p>
        </div>
        <a className="btn" href="https://github.com/hgrgr/PPFP/blob/main/docs/user-guide.md" target="_blank" rel="noopener noreferrer">
          GitHub에서 보기
        </a>
      </header>
      <article className="card guide">
        {md ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {/* The guide's own title is the page heading above */}
            {htmlImagesToMarkdown(md.replace(/^# .*\n/, ''))}
          </ReactMarkdown>
        ) : (
          <p className="sub">설명서 파일이 없습니다. `npm run build`로 다시 빌드하면 docs/user-guide.md가 함께 들어갑니다.</p>
        )}
      </article>
      <a className="btn small guide-top" href="#">
        맨 위로
      </a>
    </>
  );
}
