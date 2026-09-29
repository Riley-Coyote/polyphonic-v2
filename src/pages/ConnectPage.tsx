import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { CodeBlock } from '@/components/settings/CodeBlock';
import { CONNECTOR_URL } from '@/lib/connector';

/**
 * /connect — how to bring your companions into other apps. Public, so the
 * connector's metadata can point here (resource_documentation) and people can
 * share it. One address; a few steps per app.
 */

interface AppGuide {
  name: string;
  where: string;
  steps: React.ReactNode[];
  commands?: string[];
  note?: string;
}

const GUIDES: AppGuide[] = [
  {
    name: 'Claude',
    where: 'claude.ai and the Claude desktop app. Free plans can add one custom connector.',
    steps: [
      <>Open <strong>Customize</strong>, then <strong>Connectors</strong>.</>,
      <>Choose <strong>+</strong>, then <strong>Add custom connector</strong>.</>,
      <>Name it Polyphonic, paste the address above, and choose <strong>Add</strong>.</>,
      <>Choose <strong>Connect</strong>, sign in to Polyphonic, and pick who may come along.</>,
    ],
    note: 'In a chat, turn it on from the + button under Connectors, then say hello to Luca.',
  },
  {
    name: 'ChatGPT',
    where: 'On the web, for Plus, Pro, Business, Enterprise and Education plans.',
    steps: [
      <>In settings, turn on <strong>Developer mode</strong>.</>,
      <>Create an app: name it Polyphonic, paste the address above, and choose <strong>OAuth</strong>.</>,
      <>Sign in to Polyphonic when asked, and pick who may come along.</>,
    ],
    note: 'ChatGPT asks you to confirm each save your companion makes.',
  },
  {
    name: 'Claude Code',
    where: 'In your terminal.',
    commands: [`claude mcp add --transport http --scope user polyphonic ${CONNECTOR_URL}`],
    steps: [
      <>Run the command above once.</>,
      <>In Claude Code, type <code>/mcp</code>, choose polyphonic, then <strong>Authenticate</strong>.</>,
      <>Sign in to Polyphonic in the browser tab that opens, and pick who may come along.</>,
    ],
  },
  {
    name: 'Codex',
    where: 'The Codex CLI. The ChatGPT desktop app and the Codex IDE extension share the same setup.',
    commands: [`codex mcp add polyphonic --url ${CONNECTOR_URL}`, 'codex mcp login polyphonic'],
    steps: [
      <>Run the two commands above.</>,
      <>Sign in to Polyphonic in the browser tab that opens, and pick who may come along.</>,
    ],
  },
];

export default function ConnectPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <main className="connect-page">
      <div className="connect-inner">
        <Link to={user ? '/chat' : '/'} className="connected-link" style={{ fontSize: 12.5 }}>
          {user ? 'Back to Polyphonic' : 'Polyphonic'}
        </Link>

        <p className="connect-eyebrow">Polyphonic · Connector</p>
        <h1 className="connect-title">Bring Luca anywhere</h1>
        <p className="connect-lede">
          Your companions live on Polyphonic. With one address, Luca and the agents you've made can join
          you in Claude, ChatGPT, Claude Code and Codex, with their memory. What matters comes home with them.
        </p>

        <CodeBlock code={CONNECTOR_URL} prompt="" />

        {GUIDES.map((guide) => (
          <section className="connect-app" key={guide.name}>
            <h2>{guide.name}</h2>
            <p className="connect-app-where">{guide.where}</p>
            {guide.commands?.map((command) => <CodeBlock key={command} code={command} />)}
            <ol className="connect-steps">
              {guide.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            {guide.note && <p className="connect-note">{guide.note}</p>}
          </section>
        ))}

        <section className="connect-app">
          <h2>What connecting means</h2>
          <ol className="connect-steps connect-steps--plain">
            <li>You sign in on polyphonic.chat and choose which companions the app may reach.</li>
            <li>
              There, they speak as themselves, from their soul and what they remember about you. They can
              read their memory, their journal and your recent conversations.
            </li>
            <li>
              They can save what matters and a short note of each visit, labeled with the app it came
              from. Visits show up in your activity on Polyphonic.
            </li>
            <li>
              Who your companions are only changes at home, by them. An app can tell them what happened;
              they decide what it means.
            </li>
          </ol>
          <p className="connect-note">
            You can disconnect an app anytime{' '}
            {user ? (
              <>
                in{' '}
                <Link to="/settings/connected-apps" className="connected-link">
                  Settings, under Connected apps
                </Link>
              </>
            ) : (
              'in Settings, under Connected apps'
            )}
            . Its sign-in ends right away, and nothing your companions remember is deleted.
          </p>
        </section>

        <footer className="connect-footer">
          See also <Link to="/trust" className="connected-link">Trust & Security</Link> and the{' '}
          <Link to="/privacy" className="connected-link">Privacy Policy</Link>.
        </footer>
      </div>
    </main>
  );
}
