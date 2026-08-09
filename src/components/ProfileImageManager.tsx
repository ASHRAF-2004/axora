"use client";

import type { SupportedLocale } from "@/lib/i18n";
import { profileImageMessages } from "@/lib/profile-image-i18n";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "./UserAvatar";

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

type Phase = "idle" | "uploading" | "processing";

export function ProfileImageManager({
  name, email, locale, available, version, required, errorCode, savedState,
  onboarding, returnTo, uploadAction, removeAction,
}: ProfileImageManagerProps) {
  const copy = profileImageMessages(locale);
  const [preview, setPreview] = useState<string>();
  const [focalX, setFocalX] = useState(50);
  const [focalY, setFocalY] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [clientError, setClientError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => {
    if (phase !== "uploading") return;
    const timer = window.setInterval(() => setProgress((value) => (
      value >= 92 ? value : Math.min(92, value + Math.max(2, Math.round((100 - value) / 8)))
    )), 120);
    const processing = window.setTimeout(() => setPhase("processing"), 900);
    return () => { window.clearInterval(timer); window.clearTimeout(processing); };
  }, [phase]);

  const chooseFile = (file?: File) => {
    setClientError(undefined);
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

  return <aside className="profile-identity profile-image-manager" aria-labelledby="profile-image-title">
    <div className="profile-image-preview" data-has-preview={Boolean(preview)}>
      {preview ? <Image alt={copy.preview} fill sizes="128px" src={preview} style={{
        objectFit: "cover", objectPosition: `${focalX}% ${focalY}%`,
        transform: `scale(${zoom})`, transformOrigin: `${focalX}% ${focalY}%`,
      }} unoptimized /> : available ? <Image
        alt={copy.preview} fill sizes="128px"
        src={`/api/profile/avatar${version ? `?v=${encodeURIComponent(version)}` : ""}`} unoptimized
      /> : <UserAvatar alt={copy.preview} name={name} size={128} />}
    </div>
    <div className="profile-image-heading">
      <div><h2 id="profile-image-title">{copy.title}</h2><span>{required ? copy.required : copy.optional}</span></div>
      <div><strong>{name}</strong><span>{email}</span></div>
    </div>
    {savedState === "image" ? <p className="form-success" role="status">{copy.saved}</p> : null}
    {savedState === "image-removed" ? <p className="form-success" role="status">{copy.removed}</p> : null}
    {clientError || serverError ? <p className="form-alert" role="alert">{clientError ?? serverError}</p> : null}
    <form action={uploadAction} className="profile-image-form" onSubmit={() => { setProgress(12); setPhase("uploading"); }}>
      <input type="hidden" name="onboarding" value={onboarding ? "true" : "false"} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="focalX" value={focalX} />
      <input type="hidden" name="focalY" value={focalY} />
      <input type="hidden" name="zoom" value={zoom} />
      <label className="button button-secondary profile-image-picker"><Camera size={16} />{available ? copy.replace : copy.choose}<input
        accept="image/jpeg,image/png,image/webp" className="sr-only" name="avatar"
        onChange={(event) => chooseFile(event.currentTarget.files?.[0])} ref={inputRef} required type="file"
      /></label>
      {preview ? <div className="profile-image-crop-controls">
        <label>{copy.horizontal}<input aria-label={copy.horizontal} max="100" min="0" onChange={(event) => setFocalX(Number(event.currentTarget.value))} type="range" value={focalX} /></label>
        <label>{copy.vertical}<input aria-label={copy.vertical} max="100" min="0" onChange={(event) => setFocalY(Number(event.currentTarget.value))} type="range" value={focalY} /></label>
        <label>{copy.zoom}<input aria-label={copy.zoom} max="3" min="1" onChange={(event) => setZoom(Number(event.currentTarget.value))} step="0.05" type="range" value={zoom} /></label>
      </div> : null}
      <button className="button button-primary" disabled={!preview || phase !== "idle"} type="submit"><ImageUp size={16} />{copy.save}</button>
      {phase !== "idle" ? <div className="profile-image-progress" aria-live="polite"><progress max="100" value={phase === "processing" ? 100 : progress} /><span>{phase === "processing" ? copy.processing : copy.progress(progress)}</span></div> : null}
    </form>
    {available ? <form action={removeAction}><input type="hidden" name="onboarding" value={onboarding ? "true" : "false"} /><input type="hidden" name="returnTo" value={returnTo} /><button className="text-button" type="submit"><Trash2 size={15} />{copy.remove}</button></form> : null}
    <small>{copy.help}</small>
  </aside>;
}
