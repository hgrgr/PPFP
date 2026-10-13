import { AnalysisBoard } from '@/components/analysis-board';
import { AskAiButton } from '@/components/ai/launcher';
import { GROUPS, INCOME_BASES, INDICATORS, readPrefs, REGIONS } from '@/domain/indicators';
import { requireUser } from '@/server/auth';
import { myPropertyDistricts } from '@/server/services/indicators';

export const metadata = { title: '분석 지표' };
export const dynamic = 'force-dynamic';

export default async function AnalysisPage() {
  const user = await requireUser();
  const districts = await myPropertyDistricts(user.id);
  const indicators = INDICATORS.map(({ id, group, title, about, source, defaultOn, usesRegion, usesIncome }) => ({ id, group, title, about, source, defaultOn, usesRegion, usesIncome }));
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>분석 지표</h1>
          <p className="sub">금리·부동산·주식 시장을 읽는 지표를 한곳에 모았습니다. 지표를 켜고 끄고, 선 이름을 눌러 그래프의 선을 숨길 수 있습니다. 자료는 12시간마다 새로 받습니다.</p>
        </div>
        <div className="inline">
          <AskAiButton label="AI 지표 해석" prompt="분석 지표 화면의 금리·부동산·주식 지표를 요즘 흐름으로 해석해 줘. 장기금리를 끌어올리는 요인이 무엇인지, 집값의 수요·자금·공급 쪽 신호가 어떤지, 주식의 위험 선호가 어떤지 정리하고, 내 포트폴리오에 주는 의미를 알려 줘." />
        </div>
      </header>
      <AnalysisBoard indicators={indicators} groups={GROUPS} prefs={readPrefs(user.analysisPrefs)} regions={REGIONS.map((r) => ({ code: r.code, name: r.name }))} districts={districts} incomeBases={INCOME_BASES} />
    </>
  );
}
