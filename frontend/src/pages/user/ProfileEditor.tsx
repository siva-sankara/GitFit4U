import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";
import { MediaImageEditor } from "../../components/MediaImageEditor";
import { ProfileContactEditor } from "./ProfileContactEditor";
import "../../styles/profile-editor.css";

export function ProfileEditor({ user, onSaved }: { user: any; onSaved: () => void }) {
  const client = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const [avatar, setAvatar] = useState<{ id: string | null; url?: string }>();
  const [imageBusy, setImageBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  function markEdited() {
    setDirty(true);
    if (form.current) form.current.dataset.unsavedChanges = "true";
  }
  function clearEdits() {
    setDirty(false);
    if (form.current) delete form.current.dataset.unsavedChanges;
  }
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.href === location.href) return;
      if (!window.confirm("Leave this page and discard unsaved profile changes?")) { event.preventDefault(); event.stopPropagation(); }
      else clearEdits();
    };
    window.addEventListener("beforeunload", prevent);
    document.addEventListener("click", leave, true);
    return () => { window.removeEventListener("beforeunload", prevent); document.removeEventListener("click", leave, true); };
  }, [dirty]);
  const save = useMutation({
    mutationFn: (body: object) => apiRequest("/api/v1/users/me", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async () => {
      clearEdits();
      await client.invalidateQueries({ queryKey: ["api"] });
      await client.invalidateQueries({ queryKey: ["me"] });
      onSaved();
    },
  });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (imageBusy || save.isPending) return;
    const data = new FormData(event.currentTarget);
    save.mutate({
      name: data.get("name"),
      ...(avatar ? { avatarAttachmentId: avatar.id } : {}),
      social: {
        bio: data.get("bio"), location: data.get("location"), visibility: data.get("visibility"), timezone: data.get("timezone"),
        fitnessInterests: String(data.get("interests") || "").split(",").map(value => value.trim()).filter(Boolean),
      },
      profile: {
        gender: data.get("gender") || null, fitnessGoal: data.get("fitnessGoal"), dateOfBirth: data.get("dateOfBirth") || null,
        heightCm: data.get("heightCm") ? Number(data.get("heightCm")) : null,
        weightKg: data.get("weightKg") ? Number(data.get("weightKg")) : null,
      },
    });
  }
  function cancel() {
    if (dirty && !window.confirm("Discard your unsaved profile changes?")) return;
    form.current?.reset();
    setAvatar(undefined);
    clearEdits();
    save.reset();
    setRevision(value => value + 1);
  }
  return <div className="profile-editor">
    <form key={revision} ref={form} onSubmit={submit} onInput={markEdited} onChange={markEdited} aria-label="Edit profile">
      <fieldset className="profile-edit-group profile-photo-group">
        <legend>Profile photo</legend>
        <p className="profile-group-help">Choose a clear photo so your gym community can recognize you.</p>
        <MediaImageEditor purpose="AVATAR" label="Profile photo" previewUrl={avatar ? avatar.url : user.avatarUrl}
          onBusyChange={setImageBusy} onChange={(id, url) => { setAvatar({ id, url }); markEdited(); }} />
      </fieldset>
      <fieldset className="profile-edit-group">
        <legend>Personal information</legend>
        <div className="profile-field-grid">
          <label>Name<input name="name" defaultValue={user.name} minLength={2} maxLength={120} required autoComplete="name" /></label>
          <label>Location<input name="location" defaultValue={user.social?.location} maxLength={120} autoComplete="address-level2" /></label>
          <label className="profile-wide">Bio<textarea name="bio" defaultValue={user.social?.bio} maxLength={500} rows={3} /></label>
          <label>Gender (private)<select name="gender" defaultValue={user.profile?.gender || ""}>
            <option value="">Not specified</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="NON_BINARY">Non-binary</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
          </select></label>
          <label>Birth date (private)<input name="dateOfBirth" type="date" defaultValue={user.profile?.dateOfBirth?.slice(0, 10)} autoComplete="bday" /></label>
          <label>Profile visibility<select name="visibility" defaultValue={user.social?.visibility || "PRIVATE"}>
            <option value="PRIVATE">Private — only you</option><option value="PUBLIC">Public — signed-in members</option>
          </select></label>
          <label>Streak timezone<input name="timezone" defaultValue={user.social?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"} placeholder="Asia/Kolkata" required /></label>
        </div>
      </fieldset>
      <fieldset className="profile-edit-group">
        <legend>Fitness information</legend>
        <p className="profile-group-help">Measurements and your fitness goal are private.</p>
        <div className="profile-field-grid">
          <label>Height, cm (private)<input name="heightCm" type="number" min={50} max={260} defaultValue={user.profile?.heightCm} /></label>
          <label>Weight, kg (private)<input name="weightKg" type="number" min={20} max={400} step="0.1" defaultValue={user.profile?.weightKg} /></label>
          <label className="profile-wide">Fitness goal (private)<input name="fitnessGoal" maxLength={200} defaultValue={user.profile?.fitnessGoal} /></label>
          <label className="profile-wide">Fitness interests (comma-separated)<input name="interests" defaultValue={user.social?.fitnessInterests?.join(", ")} maxLength={700} /></label>
        </div>
      </fieldset>
      {save.error && <p className="form-alert" role="alert">{save.error.message}</p>}
      {save.isSuccess && !dirty && <p role="status">Profile saved.</p>}
      <div className="profile-edit-actions">
        <small className="subtle" aria-live="polite">{imageBusy ? "Finishing photo upload…" : dirty ? "You have unsaved changes." : "Your account details stay private unless you share them."}</small>
        <button type="button" className="btn btn-secondary" disabled={save.isPending || imageBusy} onClick={cancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending || imageBusy}>{save.isPending ? "Saving…" : "Save profile"}</button>
      </div>
    </form>
    <section className="profile-contact-group" aria-label="Contact information">
      <h3>Contact information</h3><p className="profile-group-help">Email and phone changes use verification to protect your account.</p>
      <ProfileContactEditor phone={user.phone} email={user.email} />
    </section>
  </div>;
}
