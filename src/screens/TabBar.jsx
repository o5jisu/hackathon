// 아래 탭 바 (v2): 찍기(첫 화면) · 라이브러리. 첫 화면과 포즈 라이브러리에서만 보임
const ICONS = {
  shoot: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  library: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
}

export default function TabBar({ active, onSelect, showLibrary }) {
  const tabs = [['shoot', '찍기'], ...(showLibrary ? [['library', '라이브러리']] : [])]
  return (
    <nav className="tabbar" aria-label="메뉴">
      {tabs.map(([key, label]) => (
        <button key={key} className={active === key ? 'on' : ''} aria-current={active === key ? 'page' : undefined}
          onClick={() => onSelect(key)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={active === key ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[key]}</svg>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
