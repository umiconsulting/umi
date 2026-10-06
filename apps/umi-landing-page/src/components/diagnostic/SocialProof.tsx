import React from 'react';

const SocialProof = () => (
  <div className="mt-8 border-t border-[var(--stroke)] pt-6">
    <p className="mb-3 text-center text-sm font-extrabold text-[rgba(20,33,66,0.52)]">
      Productos que puede tocar tu ruta:
    </p>
    <div className="flex flex-wrap justify-center gap-3">
      {['ConversaFlow', 'KDS', 'Cash', 'Dashboard', 'Logs'].map((name) => (
        <div
          key={name}
          className="rounded-full border border-[var(--stroke)] bg-[#fffdf8] px-3 py-2 text-xs font-extrabold text-umi-blue-dark"
        >
          {name}
        </div>
      ))}
    </div>

    <div className="mt-6 flex justify-center">
      <div className="flex items-center overflow-hidden">
        <div className="flex -space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-umi-blue-dark text-xs font-bold text-white">
            U1
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-umi-accent text-xs font-bold text-umi-blue-deep">
            U2
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-umi-light-blue text-xs font-bold text-white">
            U3
          </div>
        </div>
        <div className="ml-2">
          <p className="text-xs font-semibold text-[rgba(20,33,66,0.48)]">
            El diagnóstico es una guía inicial; el alcance final depende de tu operación.
          </p>
        </div>
      </div>
    </div>
  </div>
);

export default SocialProof;
