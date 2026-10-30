// 포즈 라이브러리 화면: 포즈 등록(F1)·목록/수정/삭제(F2)·배경 사진으로 추천(F3·F4)·추천 포즈로 연습하기(F6)
import { Component, useEffect, useRef, useState } from 'react'
import { registerPose, savePose, listPoses, updatePose, deletePose, recommendPose, TimeoutError } from './index'
import { RECOMMENDED_COUNT } from './config'
import './PoseLibrary.css'

const BODY_LABEL = { full: '전신', half: '반신', upper: '상반신' }

// 저장된 사진(Blob)을 화면에 보여 주기. 같은 사진은 임시 주소를 한 번만 만들어 재사용
const blobUrls = new WeakMap()
const urlOf = (blob) => {
  if (!blobUrls.has(blob)) blobUrls.set(blob, URL.createObjectURL(blob))
  return blobUrls.get(blob)
}

function Thumb({ blob, alt = '', className = 'pl-thumb' }) {
  return <img className={className} src={urlOf(blob)} alt={alt} />
}

// 이 기능에서 오류가 나도 앱 전체가 멈추지 않게 막는 울타리 (PRD 8: 영향 최소화)
class Boundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="panel">
        <p className="status">포즈 라이브러리에서 오류가 났어요.</p>
        <button onClick={this.props.onBack}>← 처음 화면으로</button>
      </section>
    )
  }
}

export default function PoseLibrary(props) {
  return <Boundary onBack={props.onBack}><Library {...props} /></Boundary>
}

function Library({ detect, onUsePose }) {
  const [poses, setPoses] = useState([])
  const [loadError, setLoadError] = useState('')
  const [openId, setOpenId] = useState(null) // 상세 화면으로 연 포즈
  const [drafts, setDrafts] = useState([]) // 분석은 끝났지만 아직 저장 안 한 포즈
  const [addStatus, setAddStatus] = useState('')
  const [addErrors, setAddErrors] = useState([])
  const [rec, setRec] = useState({ state: 'idle' }) // idle | loading | done | error
  const recAbort = useRef(null)

  const reload = () => listPoses().then(setPoses).catch((e) => setLoadError('저장된 포즈를 불러오지 못했어요. (' + e.message + ')'))
  useEffect(() => { reload() }, [])
  useEffect(() => () => recAbort.current?.abort(), []) // 화면을 떠나면 진행 중인 추천 취소

  // F1: 여러 장을 차례로 분석 (동시에 보내면 느린 폰·무료 한도에서 실패가 잦음)
  async function onAdd(e) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // 같은 사진을 다시 고를 수 있게
    if (!files.length) return
    const errors = []
    for (const [i, file] of files.entries()) {
      setAddStatus(`AI가 포즈를 분석하는 중… (${i + 1}/${files.length})`)
      try {
        const item = await registerPose(file, { detect })
        setDrafts((d) => [...d, item])
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`)
      }
    }
    setAddStatus('')
    setAddErrors(errors)
  }

  async function saveDraft(item) {
    await savePose(item)
    setDrafts((d) => d.filter((x) => x.id !== item.id))
    reload()
  }

  // F3·F4
  async function runRecommend(file) {
    recAbort.current?.abort()
    const ctrl = new AbortController()
    recAbort.current = ctrl
    setRec({ state: 'loading' })
    try {
      const result = await recommendPose(file, { signal: ctrl.signal })
      setRec({ state: 'done', result })
    } catch (err) {
      if (err.name === 'AbortError') return setRec({ state: 'idle' })
      const error = err instanceof TimeoutError ? '응답이 10초 넘게 걸려요. 다시 시도해 주세요.' : err.message
      setRec({ state: 'error', error, file }) // file: 다시 시도용 배경 사진
    }
  }

  function onBackground(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) runRecommend(file)
  }

  const open = poses.find((p) => p.id === openId)
  if (open) {
    return (
      <PoseDetail key={open.id} pose={open} onClose={() => setOpenId(null)} onUsePose={onUsePose}
        onSave={async (patch) => { await updatePose(open.id, patch); await reload() }}
        onDelete={async () => { await deletePose(open.id); setOpenId(null); reload() }} />
    )
  }

  return (
    <section className="page lib">
      <header className="lib-head">
        <h1>라이브러리</h1>
        <p className="hint left">
          내 포즈 {poses.length}개{poses.length < RECOMMENDED_COUNT ? ` · ${RECOMMENDED_COUNT}장 이상이면 추천이 더 정확해요` : ''}
        </p>
      </header>

      {/* ── 추천 (F3·F4): 진한 카드 ── */}
      <div className="rec-card">
        <h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
          배경에 맞는 포즈 추천
        </h2>
        <p>{poses.length === 0
          ? '먼저 아래 "포즈 추가"로 따라 하고 싶은 포즈를 등록해 주세요.'
          : '지금 있는 곳을 찍으면, 등록한 포즈 중 가장 어울리는 걸 골라 드려요.'}</p>
        {rec.state === 'loading' ? (
          <div className="pl-row">
            <span className="pl-spin" aria-hidden /> <span>배경을 보고 포즈를 고르는 중…</span>
            <button className="rec-link" onClick={() => recAbort.current?.abort()}>취소</button>
          </div>
        ) : poses.length > 0 && (
          <label className="rec-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            배경 사진 찍기
            <input type="file" accept="image/*" onChange={onBackground} />
          </label>
        )}
        {rec.state === 'error' && (
          <div className="pl-row">
            <p className="rec-error">{rec.error}</p>
            <button className="rec-link" onClick={() => runRecommend(rec.file)}>다시 시도</button>
          </div>
        )}
      </div>
      {rec.state === 'done' && <Results result={rec.result} onUsePose={onUsePose} />}

      {/* ── 등록 (F1·F2) ── */}
      {addStatus && <div className="pl-row"><span className="pl-spin" aria-hidden /> <span>{addStatus}</span></div>}
      {addErrors.map((m) => <p key={m} className="status">{m}</p>)}
      {loadError && <p className="status">{loadError}</p>}
      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} onSave={saveDraft}
          onDiscard={() => setDrafts((all) => all.filter((x) => x.id !== d.id))} />
      ))}

      {/* 핀터레스트처럼 엇갈린 2열 격자 (사진 원래 비율 그대로) */}
      {poses.length > 0 ? (
        <div className="masonry">
          {poses.map((p) => (
            <button key={p.id} className="tile" onClick={() => setOpenId(p.id)}>
              <Thumb blob={p.image} alt="" className="tile-img" />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      ) : !drafts.length && !addStatus && <p className="hint left">아직 등록한 포즈가 없어요.</p>}

      <p className="hint left">사진은 분석을 위해 AI로 보내지고 서버에 저장되지 않아요. 본인이나 허락받은 사람의 사진만 등록해 주세요.</p>

      {/* 떠 있는 추가 버튼 (여러 장 가능) */}
      <label className={`fab${addStatus ? ' disabled' : ''}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        포즈 추가
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!!addStatus} onChange={onAdd} />
      </label>
    </section>
  )
}

// F4: 추천 카드 (순위·사진·점수·이유·카메라 팁)
function Results({ result, onUsePose }) {
  return (
    <div className="pl-results">
      {result.backgroundSummary && <p className="pl-summary">📷 {result.backgroundSummary}</p>}
      {result.picks.length === 0 ? (
        <p className="hint left">맞는 포즈가 없어요, 포즈를 더 등록해 보세요.</p>
      ) : result.picks.map((pick, i) => (
        <article key={pick.poseId} className="pl-card">
          <Thumb blob={pick.pose.image} alt={pick.pose.name} className="pl-card-img" />
          <div className="pl-card-body">
            <div className="pl-card-title"><b>{i + 1}위 · {pick.pose.name}</b><span className="pl-score">{pick.score}점</span></div>
            <p>{pick.reason}</p>
            <p className="pl-tip">💡 {pick.cameraTip}</p>
            <button className="primary" onClick={() => onUsePose(pick.pose)}>이 포즈로 연습하기</button>
          </div>
        </article>
      ))}
    </div>
  )
}

// 이름·설명은 직접 고칠 수 있게 (AI 분석이 틀릴 수 있어서)
function NameFields({ value, onChange }) {
  return (
    <>
      <label className="pl-field">이름
        <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </label>
      <label className="pl-field">설명
        <textarea rows={3} value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} />
      </label>
    </>
  )
}

function Facts({ pose }) {
  return (
    <dl className="pl-facts">
      <dt>몸</dt><dd>{BODY_LABEL[pose.body] ?? pose.body} · {pose.posture}</dd>
      <dt>어울리는 배경</dt><dd>{pose.suitedBackgrounds?.join(', ')}</dd>
      <dt>필요한 것</dt><dd>{pose.needs}</dd>
      <dt>분위기</dt><dd>{pose.mood?.join(', ')}</dd>
    </dl>
  )
}

function DraftCard({ draft, onSave, onDiscard }) {
  const [v, setV] = useState({ name: draft.name, description: draft.description })
  const [error, setError] = useState('')
  return (
    <article className="pl-card draft">
      <Thumb blob={draft.image} className="pl-card-img" />
      <div className="pl-card-body">
        <p className="pl-badge">분석 결과 확인 후 저장하세요</p>
        <NameFields value={v} onChange={setV} />
        <Facts pose={draft} />
        {error && <p className="status">{error}</p>}
        <div className="actions">
          <button onClick={onDiscard}>버리기</button>
          <button className="primary" onClick={() => onSave({ ...draft, ...v }).catch((e) => setError('저장하지 못했어요. (' + e.message + ')'))}>저장</button>
        </div>
      </div>
    </article>
  )
}

function PoseDetail({ pose, onClose, onSave, onDelete, onUsePose }) {
  const [v, setV] = useState({ name: pose.name, description: pose.description })
  const [msg, setMsg] = useState('')
  const changed = v.name !== pose.name || v.description !== pose.description
  return (
    <section className="panel">
      <div className="pl-head">
        <button className="pl-back" onClick={onClose} aria-label="목록으로">←</button>
        <h1>{pose.name}</h1>
      </div>
      <Thumb blob={pose.image} alt={pose.name} className="preview" />
      <NameFields value={v} onChange={(x) => { setV(x); setMsg('') }} />
      <Facts pose={pose} />
      {msg && <p className="hint left">{msg}</p>}
      <div className="actions">
        <button disabled={!changed} onClick={() => onSave(v).then(() => setMsg('저장했어요.'), (e) => setMsg('저장하지 못했어요. (' + e.message + ')'))}>수정 저장</button>
        <button onClick={() => { if (confirm('이 포즈를 삭제할까요?')) onDelete() }}>삭제</button>
      </div>
      <button className="primary" onClick={() => onUsePose(pose)}>이 포즈로 연습하기</button>
    </section>
  )
}
