// DocBox settings. Edit the two PASTE lines with values from
// Supabase -> Project Settings -> API Keys (Project URL, and the publishable key or legacy anon key).
// That key is meant to be public; your data is protected by the database rules.
window.DOCBOX_CONFIG = {
  supabaseUrl: "https://ijxhrmupzkzginbzgout.supabase.co",
  supabaseKey: "sb_publishable_1jQsvkbNN8rafo9Qhb57Vw_QISL-x0a",

  firmName: "V Modi & Associates",
  firmCity: "Vadodara",

  // Client logins use their mobile number. Internally it becomes <mobile>@<this domain>.
  // No emails are ever sent to it. Don't change this after clients have signed up.
  clientDomain: "clients.vmodi-docbox.in",
};
