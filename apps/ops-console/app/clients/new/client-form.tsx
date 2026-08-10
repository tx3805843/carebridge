"use client";

import { useEffect, useRef, useState } from "react";
import { Button, StatusBadge, cn } from "@carebridge/ui";
import { onboardClient } from "./actions";

interface Zone {
  id: string;
  name: string;
}

const STEPS = [
  { key: "client", label: "Client", sublabel: "Identity & zone" },
  { key: "contacts", label: "Contacts", sublabel: "Emergency readiness" },
  { key: "assessment", label: "Assessment", sublabel: "Clinical needs" },
  { key: "authority", label: "Authority", sublabel: "Consent & access" },
  { key: "care-plan", label: "Care plan", sublabel: "Plan of action" },
  { key: "activate", label: "Activate", sublabel: "Final review" },
] as const;

interface Snapshot {
  fullName: string;
  dateOfBirth: string;
  address: string;
  zoneId: string;
  contactsReady: boolean;
  assessmentNoted: boolean;
  authorityReady: boolean;
  careSummary: string;
}

const EMPTY_SNAPSHOT: Snapshot = {
  fullName: "",
  dateOfBirth: "",
  address: "",
  zoneId: "",
  contactsReady: false,
  assessmentNoted: false,
  authorityReady: false,
  careSummary: "",
};

// No schema field for a nurse assessment exists yet (see the B1 design doc's Non-goals) — these
// prompts and the care-plan step's plan-of-action textarea are composed into one string and sent
// as the existing onboard_client_with_care_team RPC's p_care_summary parameter, unchanged.
function composeCareSummary(formData: FormData): string {
  const sections: [string, string][] = [
    ["Mobility needs", String(formData.get("assessmentMobility") ?? "").trim()],
    ["Medication needs", String(formData.get("assessmentMedication") ?? "").trim()],
    ["Dietary & behavioral notes", String(formData.get("assessmentDietaryBehavioral") ?? "").trim()],
    ["Plan of action", String(formData.get("carePlanNotes") ?? "").trim()],
  ];
  return sections
    .filter(([, value]) => value.length > 0)
    .map(([label, value]) => `${label}:\n${value}`)
    .join("\n\n");
}

function computeSnapshot(formData: FormData, careSummary: string): Snapshot {
  const contactNames = formData.getAll("contactFullName").map(String);
  const contactPhones = formData.getAll("contactPhone").map(String);
  const contactsReady = contactNames.some((name, index) => name.trim() && (contactPhones[index] ?? "").trim());

  const assessmentNoted = ["assessmentMobility", "assessmentMedication", "assessmentDietaryBehavioral"].some(
    (name) => String(formData.get(name) ?? "").trim().length > 0,
  );

  const sponsorRowCount = Number(formData.get("sponsorRowCount") ?? "0");
  const authorityReady = Array.from({ length: sponsorRowCount }, (_, index) => index).some(
    (index) =>
      String(formData.get(`sponsorFullName-${index}`) ?? "").trim() &&
      String(formData.get(`sponsorEmail-${index}`) ?? "").trim() &&
      String(formData.get(`sponsorRelationship-${index}`) ?? "").trim(),
  );

  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    dateOfBirth: String(formData.get("dateOfBirth") ?? ""),
    address: String(formData.get("address") ?? "").trim(),
    zoneId: String(formData.get("zoneId") ?? ""),
    contactsReady,
    assessmentNoted,
    authorityReady,
    careSummary,
  };
}

const inputClass = "rounded-md border border-border px-3 py-2";

// Every step below stays mounted for the form's whole lifetime — only `hidden` (display: none)
// toggles which one shows. Conditionally unmounting a step (the initial draft of this component
// did that) destroys its uncontrolled inputs' values on navigating away, which defeats the whole
// point of using native uncontrolled DOM fields to carry state across Next/Back. Browsers exclude
// `display: none` fields from constraint validation, so the `required` attributes on hidden steps
// don't block anything.
export function NewClientForm({ zones, error }: { zones: Zone[]; error?: string }) {
  const [step, setStep] = useState(0);
  const [contactCount, setContactCount] = useState(1);
  const [sponsorCount, setSponsorCount] = useState(1);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);

  const formRef = useRef<HTMLFormElement>(null);
  const careSummaryRef = useRef<HTMLInputElement>(null);
  const headingRefs = useRef<Array<HTMLLegendElement | null>>([]);

  useEffect(() => {
    headingRefs.current[step]?.focus();
  }, [step]);

  function syncFromForm() {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    const careSummary = composeCareSummary(data);
    if (careSummaryRef.current) careSummaryRef.current.value = careSummary;
    setSnapshot(computeSnapshot(data, careSummary));
  }

  const identityReady = Boolean(snapshot.fullName && snapshot.dateOfBirth && snapshot.address && snapshot.zoneId);
  const carePlanReady = snapshot.careSummary.length > 0;
  const canActivate = identityReady && snapshot.contactsReady && snapshot.authorityReady && carePlanReady;

  const stepComplete = [
    identityReady,
    snapshot.contactsReady,
    snapshot.assessmentNoted,
    snapshot.authorityReady,
    carePlanReady,
    false,
  ];

  const readinessItems = [
    { label: "Identity & zone", ready: identityReady },
    { label: "Emergency contact ready", ready: snapshot.contactsReady },
    { label: "Assessment noted", ready: snapshot.assessmentNoted },
    { label: "Authority captured", ready: snapshot.authorityReady },
    { label: "Care plan drafted", ready: carePlanReady },
  ];

  function legendRef(index: number) {
    return (el: HTMLLegendElement | null) => {
      headingRefs.current[index] = el;
    };
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4 lg:flex-row lg:items-start">
      <form ref={formRef} action={onboardClient} onChange={syncFromForm} className="flex min-w-0 flex-1 flex-col gap-6">
        <input type="hidden" name="careSummary" ref={careSummaryRef} />
        <input type="hidden" name="sponsorRowCount" value={sponsorCount} />

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Onboarding steps">
          {STEPS.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={step === index}
              onClick={() => setStep(index)}
              className={cn(
                "flex flex-col rounded-md border px-3 py-1.5 text-left text-sm",
                step === index ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
              )}
            >
              <span className="font-medium">
                {stepComplete[index] ? "✓ " : ""}
                {item.label}
              </span>
              <span className={cn("text-xs", step === index ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {item.sublabel}
              </span>
            </button>
          ))}
        </div>

        <fieldset className={cn("flex flex-col gap-3", step === 0 ? "" : "hidden")}>
          <legend ref={legendRef(0)} tabIndex={-1} className="text-lg font-medium">
            Client
          </legend>
          <input name="fullName" placeholder="Full name" required className={inputClass} />
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Date of birth
            <input type="date" name="dateOfBirth" required className={inputClass} />
          </label>
          <input name="address" placeholder="Address" required className={inputClass} />
          <select name="zoneId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select a zone
            </option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            How did they hear about CareBridge? (optional)
            <select name="referralSource" defaultValue="" className={inputClass}>
              <option value="">Not recorded</option>
              <option value="existing_family_referral">Referred by an existing family</option>
              <option value="staff_referral">Referred by staff</option>
              <option value="social_media">Social media</option>
              <option value="community_event">Community event</option>
              <option value="search_online">Online search</option>
              <option value="other">Other</option>
            </select>
          </label>
        </fieldset>

        <fieldset className={cn("flex flex-col gap-3", step === 1 ? "" : "hidden")}>
          <legend ref={legendRef(1)} tabIndex={-1} className="text-lg font-medium">
            Emergency contacts
          </legend>
          {Array.from({ length: contactCount }, (_, index) => (
            <div key={index} className="flex gap-2">
              <input
                name="contactFullName"
                placeholder="Contact name"
                required={index === 0}
                className={cn("flex-1", inputClass)}
              />
              <input name="contactPhone" placeholder="Phone" required={index === 0} className={cn("flex-1", inputClass)} />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setContactCount((count) => count + 1)}>
            Add another contact
          </Button>
        </fieldset>

        <fieldset className={cn("flex flex-col gap-3", step === 2 ? "" : "hidden")}>
          <legend ref={legendRef(2)} tabIndex={-1} className="text-lg font-medium">
            Assessment
          </legend>
          <p className="text-sm text-muted-foreground">
            Captures the nurse&apos;s clinical read of the client, in their own words. Combined with the care plan
            step into one care plan record.
          </p>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Mobility needs
            <textarea name="assessmentMobility" rows={2} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Medication needs
            <textarea name="assessmentMedication" rows={2} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Dietary & behavioral notes
            <textarea name="assessmentDietaryBehavioral" rows={2} className={inputClass} />
          </label>
        </fieldset>

        <fieldset className={cn("flex flex-col gap-3", step === 3 ? "" : "hidden")}>
          <legend ref={legendRef(3)} tabIndex={-1} className="text-lg font-medium">
            Family sponsors
          </legend>
          <p className="text-sm text-muted-foreground">
            Decision-maker and billing-responsible authority only — consent/photography/escort authority isn&apos;t
            built here yet.
          </p>
          {Array.from({ length: sponsorCount }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex gap-2">
                <input
                  name={`sponsorFullName-${index}`}
                  placeholder="Sponsor name"
                  required={index === 0}
                  className={cn("flex-1", inputClass)}
                />
                <input
                  name={`sponsorEmail-${index}`}
                  type="email"
                  placeholder="Sponsor email"
                  required={index === 0}
                  className={cn("flex-1", inputClass)}
                />
              </div>
              <input
                name={`sponsorRelationship-${index}`}
                placeholder="Relationship (e.g. Daughter)"
                required={index === 0}
                className={inputClass}
              />
              <div className="flex gap-4 text-sm text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name={`sponsorIsDecisionMaker-${index}`} />
                  Decision-maker
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name={`sponsorIsBillingResponsible-${index}`} />
                  Billing-responsible
                </label>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setSponsorCount((count) => count + 1)}>
            Add another sponsor
          </Button>
        </fieldset>

        <fieldset className={cn("flex flex-col gap-3", step === 4 ? "" : "hidden")}>
          <legend ref={legendRef(4)} tabIndex={-1} className="text-lg font-medium">
            Care plan
          </legend>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Plan of action
            <textarea name="carePlanNotes" rows={4} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Review due (optional)
            <input type="date" name="reviewDueAt" className={inputClass} />
          </label>
        </fieldset>

        <fieldset className={cn("flex flex-col gap-3", step === 5 ? "" : "hidden")}>
          <legend ref={legendRef(5)} tabIndex={-1} className="text-lg font-medium">
            Activate
          </legend>
          <p className="text-sm text-muted-foreground">
            Review before submitting — this creates the client, care plan, contacts, and sponsor accounts together.
          </p>
          <dl className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 text-sm">
            <div className="flex gap-2">
              <dt className="font-medium">Client:</dt>
              <dd>{snapshot.fullName || "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">Care plan summary:</dt>
              <dd className="whitespace-pre-wrap">{snapshot.careSummary || "—"}</dd>
            </div>
          </dl>
          {error ? <p className="text-sm text-critical">{error}</p> : null}
        </fieldset>

        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}>
              Next
            </Button>
          ) : (
            <Button type="submit" disabled={!canActivate}>
              Onboard client
            </Button>
          )}
        </div>
      </form>

      <div className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
        <div className="rounded-md border border-border bg-surface p-4">
          <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Draft client</h2>
          <p className="font-medium">{snapshot.fullName || "Not yet named"}</p>
          <p className="text-sm text-muted-foreground">{snapshot.dateOfBirth ? `DOB ${snapshot.dateOfBirth}` : "DOB not set"}</p>
        </div>
        <div className="rounded-md border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Activation readiness</h2>
          <ul className="flex flex-col gap-2">
            {readinessItems.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-2 text-sm">
                <span>{item.label}</span>
                <StatusBadge variant={item.ready ? "success" : "neutral"} label={item.ready ? "Complete" : "Not yet"} />
              </li>
            ))}
          </ul>
          {!canActivate ? (
            <p className="mt-3 rounded-md bg-warning/10 p-2 text-xs text-warning">
              Complete every required step before this client can be onboarded.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
