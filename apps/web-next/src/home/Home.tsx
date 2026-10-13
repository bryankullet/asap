import type { ExperienceSummary } from "@asap/schema";
import { useEffect, useState } from "react";
import { navigate } from "../app/router.js";
import { ApiError, api } from "../services/asap-api.js";
import { Attention } from "./Attention.js";
import { IntentComposer } from "./IntentComposer.js";
import { RecentWork } from "./RecentWork.js";

/**
 * Home: the one stable starting point (D-172). It asks one question, offers ways to begin, and shows
 * what needs the person, what ASAP is handling, unfinished work and what changed — from the
 * brokerage's records, never a dense dashboard. Everything begun here enters the same pipeline.
 */
export function Home() {
  const [recent, setRecent] = useState<ExperienceSummary[] | "loading" | "error">("loading");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .experiences()
      .then((r) => live && setRecent(r.items))
      .catch(() => live && setRecent("error"));
    return () => {
      live = false;
    };
  }, []);

  const start = async (text: string, subject: Parameters<typeof api.startExperience>[1] = null) => {
    setStarting(true);
    setError(null);
    try {
      const r = await api.startExperience(text, subject);
      navigate(`/x/${r.spec.experienceId}`);
    } catch (e) {
      setError(e instanceof ApiError ? (e.userMessage ?? "ASAP could not start that. Nothing was changed.") : "ASAP could not start that. Nothing was changed.");
      setStarting(false);
    }
  };

  return (
    <div className="x-home">
      <section className="x-home-hero" aria-labelledby="home-question">
        <h1 id="home-question">What would you like ASAP to handle?</h1>
        <IntentComposer busy={starting} onSubmit={(t) => void start(t)} />
        {error ? (
          <p className="x-notice x-tone-red" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <div className="x-home-cols">
        <Attention onOpen={(text, subject) => void start(text, subject)} />
        <RecentWork recent={recent} />
      </div>
    </div>
  );
}
