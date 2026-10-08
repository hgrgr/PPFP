'use client';

import '@blocknote/mantine/style.css';
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs, type PartialBlock } from '@blocknote/core';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { ko } from '@blocknote/core/locales';
import { codeBlockOptions, syntaxHighlighter } from '@blocknote/code-block';
import { BlockNoteView } from '@blocknote/mantine';
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { useEffect, useState, type MutableRefObject } from 'react';
import { BlockContext, ChartBlock, SAMPLE_CHART, StockChartBlock, type JournalBlockContext } from './blocks';

export const journalSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec({ ...codeBlockOptions, defaultLanguage: 'text' }),
    chart: ChartBlock(),
    stockChart: StockChartBlock(),
  },
});

export type JournalEditor = typeof journalSchema.BlockNoteEditor;
type Block = PartialBlock<typeof journalSchema.blockSchema, typeof journalSchema.inlineContentSchema, typeof journalSchema.styleSchema>;

async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.set('file', file);
  const res = await fetch('/api/journal/images', { method: 'POST', body });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) {
    alert(json.error ?? '이미지를 올리지 못했습니다.');
    throw new Error(json.error ?? 'upload failed');
  }
  return json.url;
}

function useScheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(m.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return dark ? 'dark' : 'light';
}

const icon = (path: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

/**
 * Notion-style block editor for a journal body: type "/" for headings, lists,
 * check lists, tables, images, code, quotes, charts and the stock chart; drag
 * blocks by their handle; paste images straight in.
 */
export default function JournalBodyEditor({
  initialContent,
  onChange,
  editable = true,
  editorRef,
  context,
}: {
  initialContent: unknown[];
  onChange?: (blocks: unknown[]) => void;
  editable?: boolean;
  editorRef?: MutableRefObject<JournalEditor | null>;
  context: JournalBlockContext;
}) {
  const editor = useCreateBlockNote({
    schema: journalSchema,
    dictionary: { ...ko, placeholders: { ...ko.placeholders, emptyDocument: "'/'를 눌러 제목·표·이미지·그래프 등을 넣으세요", default: "'/'로 블록 추가" } },
    initialContent: initialContent.length ? (initialContent as Block[]) : undefined,
    uploadFile: editable ? uploadFile : undefined,
    extensions: [syntaxHighlighter],
    tables: { headers: true, cellBackgroundColor: true, cellTextColor: true },
  });
  if (editorRef) editorRef.current = editor;
  const scheme = useScheme();

  return (
    <BlockContext.Provider value={context}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={scheme}
        slashMenu={false}
        className="journal-body"
        onChange={() => onChange?.(editor.document as unknown[])}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                {
                  title: '그래프',
                  subtext: '막대·선·영역·원형 그래프. 값을 표처럼 입력합니다.',
                  aliases: ['chart', 'graph', '차트', '그래프'],
                  group: '매매일지',
                  icon: icon('M4 20V10M10 20V4M16 20v-7M22 20H2'),
                  onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'chart', props: { data: SAMPLE_CHART } }),
                },
                {
                  title: '종목 시세 차트',
                  subtext: '이 일지 종목의 봉 차트와 목표가·손절가 선',
                  aliases: ['stock', 'candle', '시세', '봉'],
                  group: '매매일지',
                  icon: icon('M7 4v16M7 8h-2v8h2M17 4v16M17 6h-2v6h2'),
                  onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'stockChart' }),
                },
              ],
              query,
            )
          }
        />
      </BlockNoteView>
    </BlockContext.Provider>
  );
}
