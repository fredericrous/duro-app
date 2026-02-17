import styles from "./NoAccess.module.css";

interface NoAccessProps {
  user: string | null;
}

export function NoAccess({ user }: NoAccessProps) {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          width="64"
          height="64"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      </div>
      <h1 className={styles.title}>No Access</h1>
      <p className={styles.message}>
        {user
          ? `Hi ${user}, you don't have permission to access any applications.`
          : "You don't have permission to access any applications."}
      </p>
      <p className={styles.hint}>
        Please contact an administrator if you believe this is an error.
      </p>
    </div>
  );
}
