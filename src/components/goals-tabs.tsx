export function GoalsTabs({ current }: { current: 'goals' | 'backtest' }) {
  return (
    <nav className="seg" aria-label="목표" style={{ alignSelf: 'flex-start' }}>
      <a href="/goals" aria-current={current === 'goals' ? 'true' : undefined}>목표 시뮬레이션</a>
      <a href="/goals/backtest" aria-current={current === 'backtest' ? 'true' : undefined}>리밸런싱 백테스트</a>
    </nav>
  );
}
