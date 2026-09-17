export default function CppView({ code }: { code: string }) {
  const lines = code ? code.split("\n") : ["// scrie ceva valid ca să vezi C++-ul"];
  return (
    <div className="cppview">
      {lines.map((l, i) => (
        <div className="cl" key={i}>
          <span className="ln">{i + 1}</span>
          <span className="lc">{l === "" ? " " : l}</span>
        </div>
      ))}
    </div>
  );
}
