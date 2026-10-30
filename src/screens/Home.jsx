// 01 첫 화면: 앱 소개, 3단계 흐름, 모델 준비 상태, 사진 고르기·포즈 라이브러리 진입
// 모델 진행률은 실제로 알 수 없어서 퍼센트 대신 "진행 중" 막대로 표시. 로딩과 오류는 다른 모양으로 보여 줌

const STEPS = [
  ['01', '사진 고르기', '따라 할 포즈 한 장'],
  ['02', '따라 찍기', '폰이 자세를 봐 줘요'],
  ['03', '다듬어 저장', '색감 · 조정 · 필름'],
]

export default function Home({ ready, modelError, analyzing, error, onPick, onLibrary }) {
  const busy = !ready || analyzing
  return (
    <section className="page home">
      <header className="home-head">
        <p className="eyebrow">POSE · SHOOT · KEEP</p>
        <h1 className="logo">Motif<span>.</span></h1>
        <p className="home-lead">따라 하고 싶은 한 장이 있나요?<br />그 포즈로 찍을 수 있게 도와 드릴게요.</p>
      </header>

      <ol className="steps">
        {STEPS.map(([no, title, sub]) => (
          <li key={no}><i>{no}</i><b>{title}</b><span>{sub}</span></li>
        ))}
      </ol>

      <section className="tips" aria-labelledby="tips-title">
        <h2 id="tips-title">찍기 전에 알아 두면 좋아요</h2>
        <ul>
          <li>폰을 세워 두고 2~3m 뒤로 물러서면 몸 전체가 화면에 들어와요.</li>
          <li>흰 점선이 따라 할 포즈예요. 내 뼈대가 <b className="ok">초록</b>이면 맞은 곳, <b className="fix">오렌지</b>면 고칠 곳이에요.</li>
          <li>점수가 90%를 넘으면 셔터를 눌러 찍어요.</li>
        </ul>
      </section>

      <div className="dock">
        {modelError ? (
          <div className="notice error" role="alert">
            <b>포즈 인식 모델을 받지 못했어요</b>
            <span>인터넷 연결을 확인한 뒤 다시 시도해 주세요. ({modelError})</span>
            <button className="btn ghost small" onClick={() => window.location.reload()}>다시 시도</button>
          </div>
        ) : busy ? (
          <div className="loading" role="status">
            <span>{analyzing ? '사진 속 포즈를 읽는 중…' : '포즈 인식 준비 중 · 처음 한 번만 받아요'}</span>
            <div className="bar indeterminate"><i /></div>
          </div>
        ) : null}
        {error && <p className="notice error" role="alert">{error}</p>}

        {/* label 안의 input으로 사진 선택. 준비 전에는 눌리지 않고 흐리게 보임 */}
        <label className={`btn primary${busy ? ' disabled' : ''}`} aria-disabled={busy}>
          내 사진으로 시작하기
          <input type="file" accept="image/*" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f) }} />
        </label>
        {onLibrary && (
          <button className="btn ghost" onClick={onLibrary}>포즈 라이브러리 · 배경으로 추천받기</button>
        )}
      </div>
    </section>
  )
}
