import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Modal } from "./Modal";
import { apiFileDownload, apiRequest, type ApiEnvelope } from "../services/apiClient";
import { Pagination } from "./DataListControls";

type Mapping = Record<string, string>;
type UploadResult = {
  importId: string;
  fileName: string;
  columns: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestedMapping: Mapping;
  truncated: boolean;
};
type PreviewRow = {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  warnings: string[];
  state: "READY" | "INVALID";
  duplicateMemberId?: string;
};
type ValidationResult = {
  importId: string;
  rows: PreviewRow[];
  summary: Record<string, number>;
  plans: { publicId: string; name: string }[];
  trainers: { publicId: string; name: string }[];
};
const mappedFields = [
  ["name", "Member name *"], ["phone", "Phone number *"], ["email", "Email"],
  ["plan", "Membership plan"], ["accessType", "Access type"], ["startDate", "Start date"],
  ["renewalDate", "Renewal / expiry date"], ["trainer", "Trainer"], ["status", "Status"],
  ["paymentStatus", "Payment status"],
];

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export function ImportMembersModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState("SKIP");
  const [missingPlanStrategy, setMissingPlanStrategy] = useState("SKIP");
  const [newPlanDurationDays, setNewPlanDurationDays] = useState(30);
  const [newPlanPrice, setNewPlanPrice] = useState(0);
  const [planMappings, setPlanMappings] = useState<Mapping>({});
  const [trainerMappings, setTrainerMappings] = useState<Mapping>({});
  const reset = () => { setStep(1); setFile(null); setUpload(null); setMapping({}); setValidation(null); setResult(null); setPage(1); setError(""); };
  const close = () => { if (!busy) { reset(); onClose(); } };
  const uploadFile = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await apiRequest<ApiEnvelope<UploadResult>>("/api/v1/owner/members/import/preview", { method: "POST", body });
      setUpload(response.data); setMapping(response.data.suggestedMapping); setStep(2);
    } catch (failure: any) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const validate = async () => {
    if (!upload) return;
    setBusy(true); setError("");
    try {
      const response = await apiRequest<ApiEnvelope<ValidationResult>>(`/api/v1/owner/members/import/${upload.importId}/validate`, { method: "POST", body: JSON.stringify({ mapping }) });
      setValidation(response.data); setPage(1); setStep(3);
    } catch (failure: any) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!upload) return;
    setBusy(true); setError("");
    try {
      let response: ApiEnvelope<any>;
      do {
        response = await apiRequest<ApiEnvelope<any>>(`/api/v1/owner/members/import/${upload.importId}/confirm`, {
          method: "POST",
          idempotencyKey: crypto.randomUUID(),
          body: JSON.stringify({
            duplicateStrategy,
            missingPlanStrategy,
            newPlanDurationDays,
            newPlanPriceMinor: Math.round(newPlanPrice * 100),
            planMappings,
            trainerMappings,
            batchSize: 25,
          }),
        });
        setResult(response.data);
      } while (response.data.status === "PROCESSING");
      setStep(4); onImported();
    } catch (failure: any) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const visible = validation?.rows.slice((page - 1) * 10, page * 10) || [];
  const missingPlans = validation
    ? [...new Set(validation.rows.filter((row) => !row.data.planId && row.data.planValue).map((row) => row.data.planValue))]
    : [];
  const missingTrainers = validation
    ? [...new Set(validation.rows.filter((row) => !row.data.trainerId && row.data.trainerValue).map((row) => row.data.trainerValue))]
    : [];
  return (
    <Modal open={open} title="Import members" onClose={close} wide>
      <ol className="import-steps" aria-label="Import progress">
        {["Upload", "Map columns", "Validate", "Results"].map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step >= index + 1 ? "is-active" : ""}>{index + 1}<span>{label}</span></li>
        ))}
      </ol>
      {step === 1 && (
        <form className="import-upload" onSubmit={uploadFile}>
          <FileSpreadsheet size={42} aria-hidden="true" />
          <div><h3>Upload your member spreadsheet</h3><p>CSV, XLS, or XLSX up to 5 MB and 1,000 member rows.</p></div>
          <input aria-label="Member spreadsheet" type="file" accept=".csv,.xls,.xlsx" required onChange={(event) => setFile(event.target.files?.[0] || null)} />
          {file && <small>{file.name} · {(file.size / 1_000_000).toFixed(2)} MB</small>}
          <div className="heading-actions">
            <button className="btn btn-primary" disabled={!file || busy}><Upload size={17} />{busy ? "Reading file…" : "Upload and preview"}</button>
            <button type="button" className="btn btn-secondary" onClick={async () => saveBlob(await apiFileDownload("/api/v1/owner/members/import/template?format=xlsx"), "getfit4u-member-import-template.xlsx")}><Download size={17} />Sample Excel</button>
            <button type="button" className="btn btn-ghost" onClick={async () => saveBlob(await apiFileDownload("/api/v1/owner/members/import/template?format=csv"), "getfit4u-member-import-template.csv")}>Sample CSV</button>
          </div>
        </form>
      )}
      {step === 2 && upload && (
        <div className="page-stack">
          <div><h3>Map spreadsheet columns</h3><p>{upload.totalRows} rows found in {upload.fileName}. Match required and optional GETFIT4U fields.</p></div>
          {upload.truncated && <p className="form-alert" role="alert">Only the first 1,000 rows can be imported at once.</p>}
          <div className="import-mapping-grid">
            {mappedFields.map(([key, label]) => (
              <label className="field" key={key}><span>{label}</span><select className="select" value={mapping[key] || ""} onChange={(event) => setMapping({ ...mapping, [key]: event.target.value })}><option value="">Not mapped</option>{upload.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
            ))}
          </div>
          <div className="import-sample"><strong>File preview</strong><div className="responsive-table"><table><thead><tr>{upload.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{upload.sampleRows.map((row, index) => <tr key={index}>{upload.columns.map((column, cell) => <td key={column}>{row[cell] || "—"}</td>)}</tr>)}</tbody></table></div></div>
          <div className="heading-actions"><button type="button" className="btn btn-primary" disabled={busy || !mapping.name || !mapping.phone} onClick={validate}>{busy ? "Validating…" : "Validate rows"}</button><button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Change file</button></div>
        </div>
      )}
      {step === 3 && validation && (
        <div className="page-stack">
          <div className="import-summary">
            <span><strong>{validation.summary.total}</strong>Total</span><span><strong>{validation.summary.valid}</strong>Ready</span><span><strong>{validation.summary.warnings}</strong>Warnings</span><span><strong>{validation.summary.invalid}</strong>Invalid</span>
          </div>
          <div className="import-strategies">
            <label className="field"><span>Existing phone / email</span><select className="select" value={duplicateStrategy} onChange={(event) => setDuplicateStrategy(event.target.value)}><option value="SKIP">Skip existing member</option><option value="UPDATE">Update contact and trainer safely</option></select></label>
            <label className="field"><span>Unmapped membership plan</span><select className="select" value={missingPlanStrategy} onChange={(event) => setMissingPlanStrategy(event.target.value)}><option value="SKIP">Skip row</option><option value="CREATE">Create a plan from each uploaded value</option><option value="DIRECT">Import with direct gym access</option></select></label>
          </div>
          {missingPlans.length > 0 && (
            <section className="import-resolution panel-subtle">
              <h3>Resolve missing plans</h3>
              <p>Map an uploaded value to an existing plan, or leave it unmapped to use the strategy above.</p>
              <div className="import-mapping-grid">
                {missingPlans.map((name) => (
                  <label className="field" key={name}><span>{name}</span><select className="select" value={planMappings[name] || ""} onChange={(event) => setPlanMappings({ ...planMappings, [name]: event.target.value })}><option value="">Use missing-plan strategy</option>{validation.plans.map((plan) => <option key={plan.publicId} value={plan.publicId}>{plan.name}</option>)}</select></label>
                ))}
              </div>
              {missingPlanStrategy === "CREATE" && (
                <div className="import-mapping-grid">
                  <label className="field"><span>New plan duration (days)</span><input className="input" type="number" min={1} max={3650} value={newPlanDurationDays} onChange={(event) => setNewPlanDurationDays(Number(event.target.value))} /></label>
                  <label className="field"><span>New plan price (INR)</span><input className="input" type="number" min={0} step="0.01" value={newPlanPrice} onChange={(event) => setNewPlanPrice(Number(event.target.value))} /></label>
                </div>
              )}
            </section>
          )}
          {missingTrainers.length > 0 && (
            <section className="import-resolution panel-subtle">
              <h3>Resolve missing trainers</h3>
              <p>Map to an active trainer or leave the member unassigned.</p>
              <div className="import-mapping-grid">
                {missingTrainers.map((name) => (
                  <label className="field" key={name}><span>{name}</span><select className="select" value={trainerMappings[name] || ""} onChange={(event) => setTrainerMappings({ ...trainerMappings, [name]: event.target.value })}><option value="">Leave unassigned</option>{validation.trainers.map((trainer) => <option key={trainer.publicId} value={trainer.publicId}>{trainer.name}</option>)}</select></label>
                ))}
              </div>
            </section>
          )}
          <div className="responsive-table import-preview-table"><table><thead><tr><th>Row</th><th>Member</th><th>Phone</th><th>Plan</th><th>Validation</th></tr></thead><tbody>{visible.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.data.name || "—"}</td><td>{row.data.phone || "—"}</td><td>{row.data.planValue || row.data.accessType || "Direct / unmapped"}</td><td>{row.errors.length ? <span className="import-issue is-error"><AlertTriangle size={15} />{row.errors.join(" ")}</span> : row.warnings.length ? <span className="import-issue"><AlertTriangle size={15} />{row.warnings.join(" ")}</span> : <span className="import-ready"><CheckCircle2 size={15} />Ready</span>}</td></tr>)}</tbody></table></div>
          <Pagination page={page} limit={10} total={validation.rows.length} onPageChange={setPage} />
          <div className="heading-actions"><button type="button" className="btn btn-primary" disabled={busy || validation.summary.valid === 0} onClick={confirm}>{busy ? `Importing ${result?.cursor || 0} of ${result?.total || validation.summary.total}…` : "Confirm import"}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setStep(2)}>Change mapping</button></div>
        </div>
      )}
      {step === 4 && result && (
        <div className="import-complete page-stack" role="status">
          <CheckCircle2 size={46} aria-hidden="true" />
          <div><h3>Member import completed</h3><p>GETFIT4U processed every validated row. Failed or invalid rows were not partially created.</p></div>
          <div className="import-summary"><span><strong>{result.summary.imported}</strong>Imported</span><span><strong>{result.summary.updated}</strong>Updated</span><span><strong>{result.summary.skipped}</strong>Skipped</span><span><strong>{result.summary.failed}</strong>Failed</span></div>
          {(result.summary.failed > 0 || (validation?.summary.invalid || 0) > 0) && <button type="button" className="btn btn-secondary" onClick={async () => saveBlob(await apiFileDownload(`/api/v1/owner/members/import/${upload?.importId}/errors`), "getfit4u-member-import-errors.csv")}><Download size={17} />Download error report</button>}
          <button type="button" className="btn btn-primary" onClick={close}>Done</button>
        </div>
      )}
      {error && <p className="form-alert" role="alert">{error}</p>}
    </Modal>
  );
}
