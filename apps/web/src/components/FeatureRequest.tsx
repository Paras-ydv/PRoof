import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail, MessageCircle } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useMeta } from "../lib/hooks";
import { Button } from "./Button";
import { Field, Input, Textarea } from "./Form";
import { Callout, Dialog, useToast } from "./Layout";

/**
 * "Request a feature": goes straight to the PRoof team with the workspace attached.
 * Also lists the public routes (GitHub Discussions, email) for people who prefer them.
 */
export function FeatureRequestDialog({ open, onClose, workspace }: { open: boolean; onClose: () => void; workspace?: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const toast = useToast();
  const meta = useMeta();
  const send = useMutation({
    mutationFn: () => api("/support/feature-requests", { method: "POST", body: { title, body, workspace } }),
    onSuccess: () => {
      toast("pass", "Request sent. The team reads every one.");
      setTitle("");
      setBody("");
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request a feature"
      description="Need a check your org cares about, a new destination, or something else? Tell us what you're trying to do."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={send.isPending} disabled={title.trim().length < 4 || body.trim().length < 10} onClick={() => send.mutate()}>
            Send request
          </Button>
        </>
      }
    >
      <Field label="What do you need?">
        {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Require a DCO sign-off on every commit" maxLength={120} />}
      </Field>
      <Field label="Details" hint="What problem would this solve, and how do you handle it today?">
        {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} />}
      </Field>
      {workspace && <p className="dialog-note">Sent with your workspace ({workspace}) so we can follow up.</p>}
      {send.error && <Callout tone="fail">{send.error instanceof ApiError ? send.error.message : "Couldn't send. Try again."}</Callout>}
      <div className="dialog-alt">
        <span>Prefer to talk in public?</span>
        {meta.data?.repoUrl && (
          <a href={`${meta.data.repoUrl}/discussions`} target="_blank" rel="noreferrer">
            <MessageCircle /> GitHub Discussions
          </a>
        )}
        {meta.data?.contactEmail && (
          <span className="dialog-alt-email">
            <Mail /> {meta.data.contactEmail}
          </span>
        )}
      </div>
    </Dialog>
  );
}
