import { Download, RefreshCw, Smartphone, WifiOff } from "lucide-react";
import { useState } from "react";
import { ThemePicker } from "./ThemePicker";
import { Modal } from "./Modal";
import { applyAppUpdate, dismissInstall, installApp, installInstructions, restoreInstall, usePwa } from "../services/pwa";
import "../styles/pwa.css";

export function AccountAppSettings() {
  const [open, setOpen] = useState(false);
  return <><button className="btn btn-secondary" onClick={() => setOpen(true)}>App settings</button>
    {open && <Modal open title="App settings" onClose={() => setOpen(false)}><section className="account-personal"><h2>Appearance</h2><p>Choose Light or Dark.</p><ThemePicker /></section><PwaSettings /></Modal>}
  </>;
}

export function PwaSettings() {
  const pwa = usePwa();
  return <section className="panel account-personal pwa-settings" aria-label="App installation">
    <h2><Smartphone size={20} aria-hidden="true" /> GETFIT4U on your device</h2>
    {pwa.installed ? <p>GETFIT4U is running as an installed app.</p> : pwa.dismissed ? <>
      <p>Installation suggestions are hidden on this device.</p>
      <button className="btn btn-secondary" onClick={restoreInstall}>Show installation options</button>
    </> : <>
      <p>Install GETFIT4U for a dedicated app window and quick access from your home screen.</p>
      {pwa.installAvailable ? <button className="btn btn-primary" onClick={() => { void installApp(); }}><Download size={18} aria-hidden="true" />Install GETFIT4U</button> : <p>{installInstructions()}</p>}
      <button className="btn btn-secondary" onClick={dismissInstall}>Hide installation suggestions</button>
    </>}
    <p className="subtle">A connection is required for payments, bookings, attendance, messages and account changes.</p>
    {pwa.error && <p role="alert">{pwa.error}</p>}
  </section>;
}

export function PwaStatus() {
  const pwa = usePwa();
  const [showUpdate, setShowUpdate] = useState(true);
  return <div className="pwa-status" aria-live="polite">
    {!pwa.online && <div className="pwa-notice" role="status"><WifiOff size={18} aria-hidden="true" /><span>You are offline. Payments, bookings, attendance and messages need a connection. Changes are not queued.</span></div>}
    {pwa.updateAvailable && showUpdate && <div className="pwa-notice">
      <RefreshCw size={18} aria-hidden="true" /><span>An update is ready. Save your work before reloading.</span>
      <button className="btn btn-secondary" onClick={() => {
        if (window.confirm("Reload GETFIT4U now? Save any unfinished form or message first.")) applyAppUpdate();
      }}>Reload to update</button>
      <button className="btn btn-secondary" onClick={() => setShowUpdate(false)}>Later</button>
    </div>}
  </div>;
}
