import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";
import { LocationPicker } from "../../components/LocationPicker";
import { PhoneInput } from "../../components/PhoneInput";
import { validCoordinates, type LocatedPoint } from "../../services/location";
import type { Row } from "../live/LiveData";

export function GymRegistrationForm({
  initial = {},
  endpoint,
  onSaved,
  onDirty,
  disabled = false,
  onBusyChange,
}: {
  initial?: Row;
  endpoint: string;
  onSaved?: (response: any) => void;
  onDirty?: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const editing = Boolean(initial._id);
  const client = useQueryClient();
  const requestIdentity = useRef<{ body: string; key: string } | null>(null);
  const submitting = useRef(false);
  const [details, setDetails] = useState(() => ({
    name: initial.name || "",
    description: initial.description || "",
    phone: initial.contact?.phone || "",
    email: initial.contact?.email || "",
  }));
  const [address, setAddress] = useState<Record<string, string>>(() => ({
    line1: "",
    line2: "",
    locality: "",
    city: "",
    state: "",
    postalCode: "",
    country: "IN",
    ...initial.address,
  }));
  const [point, setPoint] = useState<LocatedPoint | undefined>(() =>
    initial.location?.coordinates
      ? {
          latitude: initial.location.coordinates[1],
          longitude: initial.location.coordinates[0],
        }
      : undefined,
  );
  const [confirmed, setConfirmed] = useState(editing);
  const [changed, setChanged] = useState(false);
  const [locating, setLocating] = useState(false);
  const dirty = () => {
    setChanged(true);
    onDirty?.();
  };
  const save = useMutation({
    mutationFn: () => {
      if (!validCoordinates(point) || !confirmed)
        throw new Error("Choose and confirm the gym entrance before saving.");
      const gym = {
        name: details.name.trim(),
        description: details.description.trim(),
        contact: { phone: details.phone.trim(), email: details.email.trim() },
        address: Object.fromEntries(
          Object.entries(address).map(([key, value]) => [
            key,
            String(value || "").trim(),
          ]),
        ),
        location: { coordinates: [point.longitude, point.latitude] },
      };
      const { location, ...rest } = gym;
      const body = JSON.stringify(editing ? { gym } : { ...rest, coordinates: location.coordinates });
      if (requestIdentity.current?.body !== body) requestIdentity.current = { body, key: crypto.randomUUID() };
      return apiRequest(endpoint, {
        method: editing ? "PATCH" : "POST",
        body,
        idempotencyKey: requestIdentity.current.key,
      });
    },
    onSuccess: async (response) => {
      setChanged(false);
      onSaved?.(response);
      await client.invalidateQueries();
    },
    onSettled: () => { submitting.current = false; },
  });
  useEffect(() => {
    onBusyChange?.(save.isPending || locating);
  }, [save.isPending, locating, onBusyChange]);
  return (
    <form
      className="registration-form page-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        if (!disabled && !save.isPending && !locating && !submitting.current) {
          submitting.current = true;
          save.mutate();
        }
      }}
    >
      <p>
        Fields marked * are required. Save these details before choosing a
        registration plan.
      </p>
      <fieldset
        disabled={disabled || save.isPending}
        className="registration-section"
      >
        <legend>1. Gym and contact details</legend>
        <div className="form-grid">
          <label className="field">
            <span>Gym name *</span>
            <input
              className="input"
              required
              minLength={2}
              maxLength={160}
              value={details.name}
              onChange={(e) => {
                setDetails({ ...details, name: e.target.value });
                dirty();
              }}
              autoComplete="organization"
            />
          </label>
          <label className="field">
            <span>Contact phone number *</span>
            <PhoneInput
              className="input"
              required
              value={details.phone}
              onValueChange={(value) => {
                setDetails({ ...details, phone: value });
                dirty();
              }}
            />
          </label>
          <label className="field">
            <span>Contact email *</span>
            <input
              className="input"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={details.email}
              onChange={(e) => {
                setDetails({ ...details, email: e.target.value });
                dirty();
              }}
            />
          </label>
          <label className="field full">
            <span>About your gym (optional)</span>
            <textarea
              className="textarea"
              maxLength={4000}
              value={details.description}
              onChange={(e) => {
                setDetails({ ...details, description: e.target.value });
                dirty();
              }}
            />
          </label>
        </div>
      </fieldset>
      <fieldset
        disabled={disabled || save.isPending}
        className="registration-section"
      >
        <legend>2. Gym location and address</legend>
        <p>
          Search for the gym first. Use current location only when you are at
          the gym. Move the pin to the entrance, then check the address below.
        </p>
        <LocationPicker
          value={point}
          title="Find your gym"
          addressQuery={[
            address.line1,
            address.locality,
            address.city,
            address.state,
            address.postalCode,
          ]
            .filter(Boolean)
            .join(", ")}
          onBusyChange={setLocating}
          onChange={(next) => {
            setPoint(next);
            setConfirmed(false);
            if (next.address)
              setAddress((previous) => ({ ...previous, ...next.address }));
            dirty();
          }}
        />
        <h3>Confirm the address</h3>
        <p>
          Search results may miss a building name or floor. Add those details
          here.
        </p>
        <div className="form-grid">
          {[
            ["line1", "Building and street", true],
            ["line2", "Floor, unit or landmark", false],
            ["locality", "Area / locality", false],
            ["city", "City", true],
            ["state", "State / province", true],
            ["postalCode", "PIN / postal code", true],
            ["country", "Country code (IN for India)", true],
          ].map(([key, title, required]) => (
            <label className="field" key={String(key)}>
              <span>
                {title}
                {required ? " *" : " (optional)"}
              </span>
              <input
                className="input"
                aria-label={String(title)}
                required={Boolean(required)}
                minLength={
                  key === "postalCode" ? 3 : key === "country" ? 2 : undefined
                }
                maxLength={
                  key === "country" ? 2 : key === "postalCode" ? 12 : 160
                }
                pattern={key === "country" ? "[A-Za-z]{2}" : undefined}
                value={address[String(key)] || ""}
                onChange={(e) => {
                  setAddress({
                    ...address,
                    [String(key)]:
                      key === "country"
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                  });
                  setConfirmed(false);
                  dirty();
                }}
              />
            </label>
          ))}
        </div>
        <label className="registration-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!validCoordinates(point) || locating}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              dirty();
            }}
          />
          I have checked the address and the pin marks my gym entrance.
        </label>
        {!validCoordinates(point) && (
          <p role="status">
            Choose a location above to continue. Latitude and longitude will be
            filled automatically.
          </p>
        )}
      </fieldset>
      {save.isError && (
        <p className="form-alert" role="alert">
          {save.error.message}
        </p>
      )}
      {save.isSuccess && !changed && (
        <p role="status">
          Gym details saved. Choose a registration plan to activate your gym.
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={
          disabled ||
          save.isPending ||
          locating ||
          !confirmed ||
          !validCoordinates(point)
        }
      >
        {save.isPending
          ? "Saving…"
          : editing
            ? "Save details"
            : "Save gym draft"}
      </button>
    </form>
  );
}
