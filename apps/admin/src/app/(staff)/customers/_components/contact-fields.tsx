import { CheckboxField, TextField } from "@/components/form";

type Props = { values: Record<string, string>; errors: Record<string, string>; prefix?: string };

export function ContactFields({ values: v, errors: e, prefix = "" }: Props) {
  const n = (name: string) => `${prefix}${name}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Contact name"
          name={n("name")}
          required
          defaultValue={v[n("name")]}
          error={e[n("name")]}
        />
        <TextField
          label="Role"
          name={n("role")}
          defaultValue={v[n("role")]}
          error={e[n("role")]}
          hint="Owner, trustee, managing agent, tenant..."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Email"
          name={n("email")}
          type="email"
          inputMode="email"
          autoComplete="off"
          defaultValue={v[n("email")]}
          error={e[n("email")]}
        />
        <TextField
          label="Phone / WhatsApp"
          name={n("phone")}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={v[n("phone")]}
          error={e[n("phone")]}
        />
      </div>
      <div className="space-y-2">
        <CheckboxField
          label="Receives quotes"
          name={n("receivesQuotes")}
          defaultChecked={v[n("receivesQuotes")] === "on"}
        />
        <CheckboxField
          label="Receives invoices"
          name={n("receivesInvoices")}
          defaultChecked={v[n("receivesInvoices")] === "on"}
        />
        <CheckboxField
          label="Can use the client portal"
          name={n("portalAccess")}
          defaultChecked={v[n("portalAccess")] === "on"}
          hint="Their email becomes their login when the portal opens."
        />
      </div>
    </div>
  );
}
