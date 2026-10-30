// 01 첫 화면 (v2): 큰 세리프 제목 + 폴라로이드 콜라주 + 버튼 하나. 아래에는 탭 바(App에서 붙임)
// 폴라로이드에는 라이브러리에 등록한 포즈 사진(최근 3장)을 보여 주고, 없으면 빈 액자로 둠
// 모델 진행률은 실제로 알 수 없어서 퍼센트 대신 "진행 중" 막대로 표시. 로딩과 오류는 다른 모양으로 보여 줌

const STEPS = [['01', '고르기'], ['02', '따라 찍기'], ['03', '다듬기']]

export default function Home({ ready, modelError, analyzing, error, onPick, photos = [] }) {
  const busy = !ready || analyzing
  return (
    <section className="page home">
      <header className="home-top">
        <span className="logo-sm">Motif<span>.</span></span>
        <span className="eyebrow">POSE · SHOOT · KEEP</span>
      </header>
      <h1 className="home-title">따라 하고 싶은<br />그 한 장<span>.</span></h1>
      <p className="home-lead">사진 한 장만 고르면 폰이 자세를 봐 주고,<br />색감까지 맞춰 줘요.</p>

      <div className="collage" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <figure key={i} className={`polaroid p${i}`}>
            {photos[i] ? <img src={photos[i]} alt="" /> : <span className="ph" />}
            <figcaption>No. 0{i + 1}</figcaption>
          </figure>
        ))}
      </div>

      <ol className="steps">
        {STEPS.map(([no, title], i) => (
          <li key={no}>
            <i>{no}</i>{title}
            {i < STEPS.length - 1 && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            )}
          </li>
        ))}
      </ol>

      <div className="home-actions">
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
          사진 고르기
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          <input type="file" accept="image/*" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f) }} />
        </label>
      </div>
    </section>
  )
}
