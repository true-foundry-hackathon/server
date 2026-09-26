import { useEffect, useState } from "react";
import { HomeShell } from "@/components/home-shell";
import { PhoneEntryScreen } from "@/components/phone-entry-screen";
import type { ShellTab } from "@/components/shell/shell-tabs";
import { SignInScreen } from "@/components/sign-in-screen";
import { useAuth } from "@/hooks/use-auth";
import { useCallSession } from "@/hooks/use-call-session";
import { useCollections } from "@/hooks/use-collections";
import { statusLabel } from "@/lib/status";

export default function App() {
  const auth = useAuth();
  const callSession = useCallSession(auth.auth.signed_in);

  const [activeTab, setActiveTab] = useState<ShellTab>("agent");
  const collectionsHook = useCollections(auth.auth.signed_in);

  const {
    auth: authState,
    authLoading,
    authBusy,
    authError,
    googleSignIn,
    signOut,
    linkPhone,
  } = auth;
  const {
    callState,
    isActive,
    isBusy,
    isSpeaking,
    callError,
    toggleCall,
    endCall,
  } = callSession;
  const { collections, selectedId, setSelectedId } = collectionsHook;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        authState.signed_in &&
        activeTab === "agent" &&
        !isActive &&
        !isBusy
      ) {
        void toggleCall();
      } else if (e.key === "Escape") {
        if (activeTab === "collections" && selectedId) setSelectedId(null);
        else if (activeTab !== "agent") setActiveTab("agent");
        else if (isActive || callState === "connecting") void endCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use latest state via closure refresh
  }, [authState.signed_in, activeTab, isActive, isBusy, callState, selectedId]);

  async function handleGoogleSignIn() {
    await googleSignIn(collectionsHook.reload);
  }

  const label = statusLabel(callState, callError);
  const subLabel = isActive
    ? isSpeaking
      ? "Speaking… (listening)"
      : "Listening… speak naturally"
    : isBusy || callState === "connecting"
      ? "Establishing duplex audio link…"
      : "Press the button or hit Return to talk";

  if (authLoading) {
    return (
      <main
        className="relative h-full w-full overflow-hidden bg-void-black"
        tabIndex={0}
      />
    );
  }

  if (!authState.signed_in) {
    return (
      <SignInScreen
        busy={authBusy}
        error={authError}
        onSignIn={() => void handleGoogleSignIn()}
      />
    );
  }

  if (!authState.has_phone) {
    return (
      <PhoneEntryScreen
        busy={authBusy}
        error={authError}
        onSubmit={(phoneNumber) => void linkPhone(phoneNumber)}
      />
    );
  }

  return (
    <main
      className="relative h-full w-full overflow-hidden bg-void-black"
      tabIndex={0}
    >
      <HomeShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        accountLabel={authState.email ?? authState.user_id ?? "Signed in"}
        userName={
          authState.user_name ??
          (authState.email ? authState.email.replace(/@.*/, "") : "User")
        }
        avatarUrl={authState.avatar_url ?? null}
        onSignOut={() => void signOut()}
        isActive={isActive}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={() => void toggleCall()}
        collections={collections}
        collectionsError={collectionsHook.error}
        selectedCollectionId={selectedId}
        onSelectCollection={setSelectedId}
        onCreateCollection={collectionsHook.create}
        onArchiveCollection={(id) => void collectionsHook.archive(id)}
      />
    </main>
  );
}
