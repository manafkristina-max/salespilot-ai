import { ICP } from "../api";
import { Field, TagInput } from "./ui";

export const EMPTY_ICP: ICP = {
  industries: [], geographies: [], company_types: [], employees_min: null, employees_max: null, min_sku: null, pains: [], product: "auto",
};

export const ICP_PRESET: ICP = {
  industries: ["Электроника", "Бытовая техника", "Косметика", "DIY и инструменты", "Детские товары"],
  geographies: ["Россия", "Казахстан", "Беларусь"],
  company_types: ["Бренд-производитель", "Дистрибьютор"],
  employees_min: 50, employees_max: 3000, min_sku: 300,
  pains: ["карточки", "маркетплейс", "ассортимент", "где купить"],
  product: "auto",
};

const SUG = {
  industries: ["Электроника", "Бытовая техника", "Косметика", "FMCG", "Fashion", "Детские товары", "Спорттовары", "DIY и инструменты", "Товары для дома", "Зоотовары", "Медицинские изделия"],
  geographies: ["Россия", "Казахстан", "Беларусь", "Узбекистан", "Армения"],
  company_types: ["Бренд-производитель", "Дистрибьютор", "Ритейлер", "Маркетплейс-селлер"],
  pains: ["карточки", "маркетплейс", "контент", "ассортимент", "где купить", "дилер", "excel", "атрибут"],
};

const num = (v: string) => (v === "" ? null : Math.max(0, parseInt(v, 10) || 0));

export function IcpEditor({ value, onChange, products }: { value: ICP; onChange: (v: ICP) => void; products: { id: string; name: string }[] }) {
  const set = <K extends keyof ICP>(k: K, v: ICP[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Отрасли"><TagInput value={value.industries} onChange={(v) => set("industries", v)} placeholder="Enter, чтобы добавить" suggestions={SUG.industries} /></Field>
      <Field label="География (страны / города)"><TagInput value={value.geographies} onChange={(v) => set("geographies", v)} suggestions={SUG.geographies} /></Field>
      <Field label="Тип компании"><TagInput value={value.company_types} onChange={(v) => set("company_types", v)} suggestions={SUG.company_types} /></Field>
      <Field label="Возможные проблемы (ключевые слова)" hint="Ищутся в фактах исследования — влияют на «Сигналы спроса»"><TagInput value={value.pains} onChange={(v) => set("pains", v)} suggestions={SUG.pains} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Сотрудники от"><input className="input" type="number" min={0} value={value.employees_min ?? ""} onChange={(e) => set("employees_min", num(e.target.value))} /></Field>
        <Field label="до"><input className="input" type="number" min={0} value={value.employees_max ?? ""} onChange={(e) => set("employees_max", num(e.target.value))} /></Field>
        <Field label="Мин. SKU"><input className="input" type="number" min={0} value={value.min_sku ?? ""} onChange={(e) => set("min_sku", num(e.target.value))} /></Field>
      </div>
      <Field label="Предлагаемый продукт" hint="«Авто» — Sales Agent подберёт продукт по найденным болям">
        <select className="input" value={value.product} onChange={(e) => set("product", e.target.value)}>
          <option value="auto">Авто (по болям клиента)</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
    </div>
  );
}
