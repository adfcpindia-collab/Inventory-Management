export default function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-slate-600">This module is built in a later phase.</p>
    </div>
  );
}
