import { useUIStore } from "../store/uiStore";

export function UpdateBanner() {
  const { updateInfo, setUpdateInfo } = useUIStore();
  if (!updateInfo) return null;

  const handleInstall = () => {
    window.xchatAPI?.installUpdate?.();
  };
  const handleDownload = () => {
    window.xchatAPI?.downloadUpdate?.();
  };

  return (
    <div className="update-banner">
      {updateInfo.ready ? (
        <>
          <span>xChat {updateInfo.version} 已下載完成</span>
          <button onClick={handleInstall}>立即重啟安裝</button>
          <button className="dismiss" onClick={() => setUpdateInfo(null)}>稍後</button>
        </>
      ) : updateInfo.progress > 0 ? (
        <>
          <span>正在下載更新… {updateInfo.progress}%</span>
          <progress value={updateInfo.progress} max={100} />
        </>
      ) : (
        <>
          <span>xChat {updateInfo.version} 可用</span>
          <button onClick={handleDownload}>下載更新</button>
          <button className="dismiss" onClick={() => setUpdateInfo(null)}>略過</button>
        </>
      )}
    </div>
  );
}
