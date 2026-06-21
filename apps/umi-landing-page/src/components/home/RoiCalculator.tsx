"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";

const RoiCalculator = () => {
  const [industry, setIndustry] = useState("retail");
  const [companySize, setCompanySize] = useState("small");
  const [currentAnalytics, setCurrentAnalytics] = useState("basic");

  // Valores de ROI estimados basados en las selecciones del usuario
  const getROIEstimates = () => {
    // En una implementación real, esto podría ser más complejo o conectarse a una API
    const baseEfficiency = 15;
    const baseCostReduction = 10;
    const baseRevenue = 12;

    // Ajustes basados en industria
    let industryMultiplier = 1;
    if (industry === "technology") industryMultiplier = 1.3;
    else if (industry === "manufacturing") industryMultiplier = 1.2;
    else if (industry === "services") industryMultiplier = 1.1;

    // Ajustes basados en tamaño de empresa
    let sizeMultiplier = 1;
    if (companySize === "startup") sizeMultiplier = 1.4;
    else if (companySize === "medium") sizeMultiplier = 1.2;
    else if (companySize === "large") sizeMultiplier = 1.1;

    // Ajustes basados en nivel actual de análisis
    let analyticsMultiplier = 1;
    if (currentAnalytics === "none") analyticsMultiplier = 1.5;
    else if (currentAnalytics === "intermediate") analyticsMultiplier = 0.8;
    else if (currentAnalytics === "advanced") analyticsMultiplier = 0.6;

    // Cálculos finales
    const efficiency = Math.round(
      baseEfficiency * industryMultiplier * analyticsMultiplier
    );
    const costReduction = Math.round(
      baseCostReduction * sizeMultiplier * analyticsMultiplier
    );
    const revenue = Math.round(
      baseRevenue * industryMultiplier * sizeMultiplier
    );

    // ROI total (simplificado para este ejemplo)
    const totalRoi = ((efficiency + costReduction + revenue) / 20).toFixed(1);

    return {
      efficiency,
      costReduction,
      revenue,
      totalRoi,
    };
  };

  const roi = getROIEstimates();

  return (
    <section className="py-20 bg-white">
      <div className="container-wide">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              viewport={{ once: true }}
              className="text-3xl md:text-4xl font-domus font-semibold text-gray-900 mb-4"
            >
              Calcula tu ROI Potencial
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              viewport={{ once: true }}
              className="text-xl text-gray-600"
            >
              Estima el retorno de inversión potencial al implementar análisis
              de datos en tu negocio.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="bg-gray-50 p-6 md:p-8 rounded-lg shadow-md"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <div className="mb-6">
                  <label
                    htmlFor="industry"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Industria
                  </label>
                  <select
                    id="industry"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-umi-light-blue focus:border-umi-light-blue"
                  >
                    <option value="retail">Comercio Minorista</option>
                    <option value="technology">Tecnología</option>
                    <option value="manufacturing">Manufactura</option>
                    <option value="services">Servicios</option>
                    <option value="other">Otra</option>
                  </select>
                </div>
                <div className="mb-6">
                  <label
                    htmlFor="companySize"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Tamaño de Empresa
                  </label>
                  <select
                    id="companySize"
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-umi-light-blue focus:border-umi-light-blue"
                  >
                    <option value="startup">Startup/Emprendimiento</option>
                    <option value="small">PyME pequeña (1-10 empleados)</option>
                    <option value="medium">
                      PyME mediana (11-50 empleados)
                    </option>
                    <option value="large">
                      Empresa grande (51+ empleados)
                    </option>
                  </select>
                </div>
                <div className="mb-6">
                  <label
                    htmlFor="currentAnalytics"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Nivel Actual de Análisis
                  </label>
                  <select
                    id="currentAnalytics"
                    value={currentAnalytics}
                    onChange={(e) => setCurrentAnalytics(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-umi-light-blue focus:border-umi-light-blue"
                  >
                    <option value="none">Sin análisis formal</option>
                    <option value="basic">
                      Análisis básico (hojas de cálculo)
                    </option>
                    <option value="intermediate">
                      Análisis intermedio (dashboards simples)
                    </option>
                    <option value="advanced">
                      Análisis avanzado (busca optimización)
                    </option>
                  </select>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="font-domus text-xl font-semibold text-gray-900 mb-4">
                  ROI Estimado
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Eficiencia Operativa</span>
                    <span className="font-semibold text-umi-blue-dark">
                      +{roi.efficiency}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Reducción de Costos</span>
                    <span className="font-semibold text-umi-blue-dark">
                      +{roi.costReduction}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">
                      Incremento de Ingresos
                    </span>
                    <span className="font-semibold text-umi-blue-dark">
                      +{roi.revenue}%
                    </span>
                  </div>
                  <div className="pt-4 mt-4 border-t border-gray-200">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-800">
                        ROI Total Estimado
                      </span>
                      <span className="font-bold text-lg text-umi-blue-dark">
                        {roi.totalRoi}x
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-8">
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => (window.location.href = "#contacto")}
                  >
                    Obtener informe detallado
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default RoiCalculator;
