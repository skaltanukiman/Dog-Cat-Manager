"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type PetWeightChartPoint = {
  date: string;
  weightKg: number;
};

export function PetWeightChart({ data }: { data: PetWeightChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-sm text-slate-500">
        体重記録がまだありません。
      </div>
    );
  }

  return (
    <div className="h-72 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} unit="kg" width={62} domain={["auto", "auto"]} />
          <Tooltip formatter={(value) => [`${value}kg`, "体重"]} labelFormatter={(label) => `測定日: ${label}`} />
          <Line
            type="monotone"
            dataKey="weightKg"
            stroke="#D97955"
            strokeWidth={2.5}
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
