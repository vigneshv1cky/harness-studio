"use client";

import { useState } from "react";

export function CounterButton() {
  const [count, setCount] = useState(0);
  return (
    <button
      type="button"
      onClick={() => setCount((n) => n + 1)}
      className="rounded-full bg-blue-600 px-5 py-3 text-white hover:bg-blue-700"
    >
      Clicked {count} times
    </button>
  );
}
