import { notFound } from 'next/navigation';
import { TemplateForm } from '@/components/journal/template-form';
import { requireUser } from '@/server/auth';
import { journalFormats } from '@/server/services/journal';

export const metadata = { title: '매매일지 양식' };
export const dynamic = 'force-dynamic';

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const formats = await journalFormats(user.id);
  if (id === 'new') {
    const from = formats.find((f) => f.id === sp.from);
    return <TemplateForm initial={{ name: from ? `${from.name} (내 양식)` : '', description: from?.description ?? '', fields: from?.fields ?? [], content: from?.content ?? [] }} />;
  }
  const t = formats.find((f) => f.custom && f.id === id);
  if (!t) notFound();
  return <TemplateForm initial={{ id: t.id, name: t.name, description: t.description, fields: t.fields, content: t.content }} />;
}
