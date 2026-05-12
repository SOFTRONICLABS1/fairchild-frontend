"use client";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({ value: z.string().min(1) });

export default function SimpleForm({ label, placeholder, onSubmit }: { label: string; placeholder: string; onSubmit: (value: string)=>void }) {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { value: "" } });
  return <form onSubmit={form.handleSubmit((v)=>onSubmit(v.value))} className="space-y-2">
    <label className="text-sm font-medium">{label}</label>
    <input className="h-10 w-full rounded border px-3" placeholder={placeholder} {...form.register("value")} />
    {form.formState.errors.value && <p className="text-xs text-red-600">{form.formState.errors.value.message}</p>}
    <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" type="submit">Submit</button>
  </form>;
}
