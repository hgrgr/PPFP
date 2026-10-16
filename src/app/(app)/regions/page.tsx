import { Suspense } from 'react';
import { AskAiButton } from '@/components/ai/launcher';
import { RegionAnalysis, type RegionOption } from '@/components/region-analysis';
import { MACROS, RONE_REGIONS, regionOfAddress } from '@/domain/region-analysis';
import { requireUser } from '@/server/auth';
import { myPropertyDistricts } from '@/server/services/indicators';

export const metadata = { title: '지역 분석' };
export const dynamic = 'force-dynamic';

export default async function RegionsPage() {
  const user = await requireUser();
  const regions: RegionOption[] = RONE_REGIONS.map((r) => ({ key: r.key, label: r.label, depth: r.depth }));
  // The regions of the user's linked real estate come first among the quick picks
  const mine = (await myPropertyDistricts(user.id)).flatMap((d) => {
    const r = regionOfAddress(d.name);
    return r ? [{ key: r.key, label: r.label, depth: r.depth }] : [];
  });
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>지역 분석</h1>
          <p className="sub">아파트 시장을 지역 단위로 봅니다. 한 지역의 가격·전세·수급·거래와 국면, 여러 지역 비교, 시도별 순환 국면, 금리 같은 지표와 집값의 시차를 한국부동산원 통계로 보여 줍니다.</p>
        </div>
        <div className="inline">
          <AskAiButton label="AI 지역 해석" prompt="지역 분석 화면에서 보고 있는 지역의 아파트 시장을 해석해 줘. 매매·전세 흐름, 전세가율과 수급, 거래량, 4분면·벌집순환 국면이 무엇을 말하는지, 다른 시도와 비교해 어떤 위치인지 정리해 줘." />
        </div>
      </header>
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <RegionAnalysis regions={regions} macros={MACROS.map((m) => ({ key: m.key, label: m.label }))} mine={mine.filter((r, i, a) => a.findIndex((x) => x.key === r.key) === i)} />
      </Suspense>
    </>
  );
}
