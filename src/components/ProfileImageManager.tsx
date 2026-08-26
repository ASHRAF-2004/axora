"use client";

import type { SupportedLocale } from "@/lib/i18n";
import { profileImageMessages } from "@/lib/profile-image-i18n";
import {
  ProfileImageRequestError,
  startProfileImageRequest,
  type ActiveProfileImageRequest,
} from "@/lib/profile-image-upload-client";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { UserAvatar } from "./UserAvatar";

function subscribeToHydration() {
  return () => {};
}

interface ProfileImageManagerProps {
  name: string;
  email: string;
  locale: SupportedLocale;
  available: boolean;
  version?: string;
  required: boolean;
  errorCode?: string;
  savedState?: string;
  onboarding: boolean;
  returnTo: string;
  uploadAction: (formData: FormData) => void | Promise<void>;
  removeAction: (formData: FormData) => void | Promise<void>;
}

type Phase = "idle" | "uploading" | "processing" | "removing";

function completedPath(
  saved: "image" | "image-removed",
  onboarding: boolean,
  returnTo: string,
) {
  const params = new URLSearchParams({ saved, returnTo });
  if (onboarding) params.set("onboarding", "1");
  return `/profile?${params.toString()}`;
}

export function ProfileImageManager({
  name, email, locale, available, version, required, errorCode, savedState,
  onboarding, returnTo, uploadAction, removeAction,
}: ProfileImageManagerProps) {
  const router = useRouter();
  const copy = profileImageMessages(locale);
  const [preview, setPreview] = useState<string>();
  const [focalX, setFocalX] = useState(50);
  const [focalY, setFocalY] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [clientError, setClientError] = useState<string>();
  const [clientNotice, setClientNotice] = useState<string>();
  const [activeAvailable, setActiveAvailable] = useState(available);
  const [activeVersion, setActiveVersion] = useState(version);
  const interactive = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<ActiveProfileImageRequest | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => () => requestRef.current?.cancel(), []);

  const chooseFile = (file?: File) => {
    setClientError(undefined);
    setClientNotice(undefined);
    if (!file) return;
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      setClientError(copy.errors.size);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setClientError(copy.errors.type);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setFocalX(50); setFocalY(50); setZoom(1);
  };
  const serverError = errorCode?.startsWith("image-")
    ? copy.errors[errorCode.slice(6)] ?? copy.errors.unavailable
    : undefined;
  const busy = phase !== "idle";
  const notice = savedState === "image"
    ? copy.saved
    : savedState === "image-removed"
      ? copy.removed
      : clientNotice;

  const requestFailure = (error: unknown) => {
    if (!(error instanceof ProfileImageRequestError)) {
      setClientError(copy.errors.unavailable);
      return;
    }
    if (error.cancelled && !error.uncertain) {
      setClientError(copy.cancelled);
      return;
    }
    const message = error.uncertain
      ? copy.uncertain
      : copy.errors[error.code] ?? copy.errors.unavailable;
    setClientError(`${message} ${copy.reference(error.referenceId)}`);
  };

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !inputRef.current?.files?.[0]) return;
    setClientError(undefined);
    setClientNotice(undefined);
    setProgress(0);
    setPhase("uploading");
    const request = startProfileImageRequest({
      method: "POST",
      body: new FormData(event.currentTarget),
      onUploadProgress: setProgress,
      onProcessing: () => setPhase("processing"),
    });
    requestRef.current = request;
    try {
      const result = await request.promise;
      setActiveAvailable(true);
      setActiveVersion(result.versionId);
      window.dispatchEvent(new CustomEvent("axora:profile-avatar-changed", {
        detail: { url: result.versionId
          ? `/api/profile/avatar?v=${encodeURIComponent(result.versionId)}`
          : "/api/profile/avatar" },
      }));
      setPreview(undefined);
      if (inputRef.current) inputRef.current.value = "";
      setClientNotice(copy.saved);
      router.replace(completedPath("image", onboarding, returnTo));
    } catch (error) {
      requestFailure(error);
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      setPhase("idle");
      setProgress(0);
    }
  };

  const submitRemoval = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setClientError(undefined);
    setClientNotice(undefined);
    setPhase("removing");
    const request = startProfileImageRequest({ method: "DELETE" });
    requestRef.current = request;
    try {
      await request.promise;
      setActiveAvailable(false);
      setActiveVersion(undefined);
      window.dispatchEvent(new CustomEvent("axora:profile-avatar-changed", {
        detail: { url: null },
      }));
      setClientNotice(copy.removed);
      router.replace(completedPath("image-removed", onboarding, returnTo));
    } catch (error) {
      requestFailure(error);
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      setPhase("idle");
    }
  };

  return <aside className="profile-identity profile-image-manager" aria-busy={busy}
    aria-labelledby="profile-image-title" data-phase={phase}>
    <div className="profile-image-preview" data-has-preview={Boolean(preview)}>
      {preview ? <Image alt={copy.preview} fill sizes="128px" src={preview} style={{
        objectFit: "cover", objectPosition: `${focalX}% ${focalY}%`,
        transform: `scale(${zoom})`, transformOrigin: `${focalX}% ${focalY}%`,
      }} unoptimized /> : activeAvailable ? <Image
        alt={copy.preview} fill sizes="128px"
        src={`/api/profile/avatar${activeVersion ? `?v=${encodeURIComponent(activeVersion)}` : ""}`} unoptimized
      /> : <UserAvatar alt={copy.preview} name={name} size={128} />}
    </div>
    <div className="profile-image-heading">
      <div><h2 id="profile-image-title">{copy.title}</h2><span>{required ? copy.required : copy.optional}</span></div>
      <div><strong>{name}</strong><span>{email}</span></div>
    </div>
    {notice ? <p className="form-success" role="status">{notice}</p> : null}
    {clientError || serverError ? <p className="form-alert" role="alert">{clientError ?? serverError}</p> : null}
    <form action={uploadAction} className="profile-image-form" onSubmit={submitUpload}>
      <input type="hidden" name="onboarding" value={onboarding ? "true" : "false"} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="focalX" value={focalX} />
      <input type="hidden" name="focalY" value={focalY} />
      <input type="hidden" name="zoom" value={zoom} />
      {interactive ? <label className="button button-secondary profile-image-picker"><Camera size={16} aria-hidden="true" />{activeAvailable ? copy.replace : copy.choose}<input
        accept="image/jpeg,image/png,image/webp" className="sr-only" name="avatar"
        disabled={busy} onChange={(event) => chooseFile(event.currentTarget.files?.[0])} ref={inputRef} required type="file"
      /></label> : <span aria-busy="true" aria-disabled="true" className="button button-secondary profile-image-picker"><Camera size={16} aria-hidden="true" />{activeAvailable ? copy.replace : copy.choose}</span>}
      {preview ? <div className="profile-image-crop-controls">
        <label>{copy.horizontal}<input aria-label={copy.horizontal} disabled={busy} max="100" min="0" onChange={(event) => setFocalX(Number(event.currentTarget.value))} type="range" value={focalX} /></label>
        <label>{copy.vertical}<input aria-label={copy.vertical} disabled={busy} max="100" min="0" onChange={(event) => setFocalY(Number(event.currentTarget.value))} type="range" value={focalY} /></label>
        <label>{copy.zoom}<input aria-label={copy.zoom} disabled={busy} max="3" min="1" onChange={(event) => setZoom(Number(event.currentTarget.value))} step="0.05" type="range" value={zoom} /></label>
      </div> : null}
      <button className="button button-primary" disabled={!preview || busy} type="submit"><ImageUp size={16} aria-hidden="true" />{clientError && preview ? copy.retry : copy.save}</button>
      {phase === "uploading" ? <div className="profile-image-progress" aria-live="polite"><progress max="100" value={progress} /><span>{copy.progress(progress)}</span></div> : null}
      {phase === "processing" ? <div className="profile-image-progress" aria-live="polite"><progress aria-label={copy.processing} /><span>{copy.processing}</span></div> : null}
      {phase === "uploading" || phase === "processing" ? <button className="text-button" onClick={() => requestRef.current?.cancel()} type="button">{copy.cancel}</button> : null}
    </form>
    {phase === "removing" ? <p aria-live="polite" role="status">{copy.removing}</p> : null}
    {activeAvailable ? <form action={removeAction} onSubmit={submitRemoval}><input type="hidden" name="onboarding" value={onboarding ? "true" : "false"} /><input type="hidden" name="returnTo" value={returnTo} /><button className="text-button" disabled={busy} type="submit"><Trash2 size={15} aria-hidden="true" />{copy.remove}</button></form> : null}
    <small>{copy.help}</small>
  </aside>;
}
