// PoseStore: 포즈 라이브러리를 브라우저 안 저장소(IndexedDB)에 보관합니다.
// 기존 앱 데이터와 섞이지 않게 전용 DB 이름(pose_library)을 씁니다. 사진도 Blob으로 같이 저장 → 새로고침해도 남음.
const DB_NAME = 'pose_library', STORE = 'poses'

let dbP = null
function openDb() {
  dbP ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbP = null; reject(req.error) }
  })
  return dbP
}

// 요청 하나를 Promise로 감싸기 (IndexedDB는 콜백 방식이라)
async function run(mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => reject(tx.error)
  })
}

export const poseStore = {
  save: (p) => run('readwrite', (s) => s.put(p)),
  getAll: async () => {
    const all = await run('readonly', (s) => s.getAll())
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  },
  update: async (id, patch) => {
    const cur = await run('readonly', (s) => s.get(id))
    if (!cur) throw new Error('포즈를 찾을 수 없어요.')
    await run('readwrite', (s) => s.put({ ...cur, ...patch, id }))
  },
  remove: (id) => run('readwrite', (s) => s.delete(id)),
}
