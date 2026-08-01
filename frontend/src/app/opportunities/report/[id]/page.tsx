import ReportView from './ReportView';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } | Promise<{ id: string }> };

export default async function ReportPage({ params }: Ctx) {
  const { id } = await params;
  return <ReportView id={id} />;
}
