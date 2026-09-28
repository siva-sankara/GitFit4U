import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";
import { MediaImageEditor } from "../../components/MediaImageEditor";
import { ProfileContactEditor } from "./ProfileContactEditor";
export function ProfileEditor({
  user,
  onSaved,
}: {
  user: any;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const [avatar, setAvatar] = useState<{ id: string | null; url?: string }>();
  const [imageBusy, setImageBusy] = useState(false);
  const save = useMutation({
    mutationFn: (body: object) =>
      apiRequest("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["api"] });
      await client.invalidateQueries({ queryKey: ["me"] });
      onSaved();
    },
  });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save.mutate({
      name: data.get("name"),
      ...(avatar ? { avatarAttachmentId: avatar.id } : {}),
      social: {
        bio: data.get("bio"),
        location: data.get("location"),
        visibility: data.get("visibility"),
        timezone: data.get("timezone"),
        fitnessInterests: String(data.get("interests") || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      },
      profile: {
        gender: data.get("gender") || null,
        fitnessGoal: data.get("fitnessGoal"),
        dateOfBirth: data.get("dateOfBirth") || null,
        heightCm: data.get("heightCm") ? Number(data.get("heightCm")) : null,
        weightKg: data.get("weightKg") ? Number(data.get("weightKg")) : null,
      },
    });
  }
  return (
    <div className="profile-editor">
      <form onSubmit={submit}>
        <MediaImageEditor
          purpose="AVATAR"
          label="Profile photo"
          previewUrl={avatar ? avatar.url : user.avatarUrl}
          onBusyChange={setImageBusy}
          onChange={(id, url) => setAvatar({ id, url })}
        />
        <div className="profile-field-grid">
          <label>
            Name
            <input
              name="name"
              defaultValue={user.name}
              minLength={2}
              maxLength={120}
              required
            />
          </label>
          <label>
            Location
            <input
              name="location"
              defaultValue={user.social?.location}
              maxLength={120}
            />
          </label>
          <label className="profile-wide">
            Bio
            <textarea
              name="bio"
              defaultValue={user.social?.bio}
              maxLength={500}
              rows={3}
            />
          </label>
          <label className="profile-wide">
            Fitness interests (comma-separated)
            <input
              name="interests"
              defaultValue={user.social?.fitnessInterests?.join(", ")}
              maxLength={700}
            />
          </label>
          <label>
            Profile visibility
            <select
              name="visibility"
              defaultValue={user.social?.visibility || "PRIVATE"}
            >
              <option value="PRIVATE">Private — only you</option>
              <option value="PUBLIC">Public — signed-in members</option>
            </select>
          </label>
          <label>
            Streak timezone
            <input
              name="timezone"
              defaultValue={
                user.social?.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                "Asia/Kolkata"
              }
              placeholder="Asia/Kolkata"
              required
            />
          </label>
          <label>
            Gender (private)
            <select name="gender" defaultValue={user.profile?.gender || ""}>
              <option value="">Not specified</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="NON_BINARY">Non-binary</option>
              <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
            </select>
          </label>
          <label>
            Birth date (private)
            <input
              name="dateOfBirth"
              type="date"
              defaultValue={user.profile?.dateOfBirth?.slice(0, 10)}
            />
          </label>
          <label>
            Height, cm (private)
            <input
              name="heightCm"
              type="number"
              min={50}
              max={260}
              defaultValue={user.profile?.heightCm}
            />
          </label>
          <label>
            Weight, kg (private)
            <input
              name="weightKg"
              type="number"
              min={20}
              max={400}
              step="0.1"
              defaultValue={user.profile?.weightKg}
            />
          </label>
          <label className="profile-wide">
            Fitness goal (private)
            <input
              name="fitnessGoal"
              maxLength={200}
              defaultValue={user.profile?.fitnessGoal}
            />
          </label>
        </div>
        {save.error && <p role="alert">{save.error.message}</p>}
        <button
          className="btn btn-primary"
          disabled={save.isPending || imageBusy}
        >
          {save.isPending ? "Saving…" : "Save profile"}
        </button>
      </form>
      <ProfileContactEditor phone={user.phone} email={user.email} />
    </div>
  );
}
