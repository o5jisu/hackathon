// 01 첫 화면: 로고, 한 줄 소개, 3단계, 사진 고르기·포즈 라이브러리 진입 (글은 최소로, 여백 위주)
// 모델 진행률은 실제로 알 수 없어서 퍼센트 대신 "진행 중" 막대로 표시. 로딩과 오류는 다른 모양으로 보여 줌

const STEPS = [['01', '고르기'], ['02', '따라 찍기'], ['03', '다듬기']]

export default function Home({ ready, modelError, analyzing, error, onPick, onLibrary }) {
  const busy = !ready || analyzing
  return (
    <section className="page home">
      <header className="home-head">
        <p className="eyebrow">POSE · SHOOT · KEEP</p>
        <h1 className="logo">Motif<span>.</span></h1>
        <p className="home-lead">따라 하고 싶은 그 포즈,<br />그대로 찍어 보세요.</p>
      </header>

      <ol className="steps">
        {STEPS.map(([no, title]) => <li key={no}><i>{no}</i>{title}</li>)}
      </ol>

      <div className="dock">
        {modelError ? (
          <div className="notice error" role="alert">
            <b>포즈 인식 모델을 받지 못했어요</b>
            <span>인터넷 연결을 확인한 뒤 다시 시도해 주세요. ({modelError})</span>
            <button className="btn ghost small" onClick={() => window.location.reload()}>다시 시도</button>
          </div>
        ) : busy ? (
          <div className="loading" role="status">
            <span>{analyzing ? '사진 속 포즈를 읽는 중…' : '준비 중 · 처음 한 번만 받아요'}</span>
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
          <button className="text-btn center" onClick={onLibrary}>포즈 라이브러리에서 고르기</button>
        )}
      </div>
    </section>
  )
}
