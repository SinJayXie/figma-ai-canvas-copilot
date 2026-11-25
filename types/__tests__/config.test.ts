import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GENERATION,
  DEFAULT_MODEL_ID,
  normalizeConfig,
  parseExtraBody,
  resolveActiveModel,
  resolveActiveModelEntry,
  type ModelEntry,
  type PluginConfig,
} from '../config.types'

function entry(partial: Partial<ModelEntry> & { id: string }): ModelEntry {
  return {
    name: partial.name ?? partial.id,
    provider: partial.provider ?? 'custom',
    model: partial.model ?? '',
    baseUrl: partial.baseUrl ?? '',
    apiKey: partial.apiKey ?? '',
    generation: partial.generation ?? { ...DEFAULT_GENERATION, stop: [] },
    ...partial,
  }
}

describe('normalizeConfig', () => {
  it('默认配置保留一条空白模型占位并同步 model', () => {
    const config = normalizeConfig()
    expect(config.models).toHaveLength(1)
    expect(config.activeModelId).toBe(DEFAULT_MODEL_ID)
    expect(config.models[0].model).toBe('')
    expect(config.models[0].provider).toBe('custom')
    expect(config.models[0].baseUrl).toBe('')
    expect(config.model).toBe(config.models[0].model)
    expect(resolveActiveModel(config)).toBe('')
  })

  it('旧版本全局 baseUrl / apiKey / model 迁移为单模型', () => {
    const legacy = {
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-legacy',
    } as unknown as Partial<PluginConfig>
    const config = normalizeConfig(legacy)
    expect(config.models).toHaveLength(1)
    expect(config.models[0].model).toBe('gpt-4o')
    expect(config.models[0].baseUrl).toBe('https://api.openai.com/v1')
    expect(config.models[0].apiKey).toBe('sk-legacy')
    expect(config.models[0].provider).toBe('openai')
    expect(config.activeModelId).toBe(config.models[0].id)
  })

  it('保留多模型各自的 Base URL 与 API Key', () => {
    const config = normalizeConfig({
      models: [
        entry({ id: 'a', name: 'DeepSeek', provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-a' }),
        entry({ id: 'b', name: 'OpenAI', provider: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-b' }),
      ],
      activeModelId: 'b',
      model: 'gpt-4o',
    })
    expect(config.models).toHaveLength(2)
    expect(config.activeModelId).toBe('b')
    expect(config.models[0].apiKey).toBe('sk-a')
    expect(config.models[1].baseUrl).toBe('https://api.openai.com/v1')
    expect(resolveActiveModelEntry(config).apiKey).toBe('sk-b')
  })

  it('修复失效的 activeModelId', () => {
    const config = normalizeConfig({
      models: [
        entry({ id: 'a', model: 'deepseek-chat' }),
        entry({ id: 'b', model: 'gpt-4o' }),
      ],
      activeModelId: 'missing',
      model: 'gpt-4o',
    })
    expect(config.activeModelId).toBe('b')
    expect(config.model).toBe('gpt-4o')
  })

  it('允许新增模型暂时为空 model（编辑中不被丢弃）', () => {
    const config = normalizeConfig({
      models: [
        entry({ id: 'a', model: 'deepseek-chat' }),
        entry({ id: 'b', name: '模型 B', model: '' }),
      ],
      activeModelId: 'a',
      model: 'deepseek-chat',
    })
    expect(config.models).toHaveLength(2)
    expect(config.models[1].model).toBe('')
  })

  it('过滤重复 id 与空条目，并保证至少一条', () => {
    const config = normalizeConfig({
      models: [
        entry({ id: 'a', model: 'x' }),
        entry({ id: 'a', model: 'y' }),
        entry({ id: '', model: 'z' }),
      ],
      activeModelId: 'a',
      model: 'x',
    })
    expect(config.models).toHaveLength(1)
    expect(config.models[0].model).toBe('x')
  })

  it('归一化自定义指令：补 / 前缀、去空白、去重、过滤空项', () => {
    const config = normalizeConfig({
      customCommands: [
        { label: '骨架', description: '  说明  ', prompt: '  画一个骨架  ' },
        { label: '/骨架', description: '', prompt: '重复项应被丢弃' },
        { label: '/', description: '', prompt: '空指令名应被丢弃' },
        { label: '/无模板', description: '', prompt: '   ' },
      ],
    })
    expect(config.customCommands).toEqual([
      { label: '/骨架', description: '说明', prompt: '画一个骨架' },
    ])
  })

  it('生成参数越界时自动限幅（旧全局参数迁移到模型）', () => {
    const config = normalizeConfig({
      temperature: 5,
      topP: -1,
      topK: 999,
      maxTokens: 999999,
      presencePenalty: -9,
      frequencyPenalty: 9,
      repetitionPenalty: -2,
      seed: -5,
      stop: ['a', 'b', 'c', 'd', 'e'],
      thinkingBudget: -100,
    } as unknown as Partial<PluginConfig>)
    const generation = config.models[0].generation
    expect(generation.temperature).toBe(2)
    expect(generation.topP).toBe(0)
    expect(generation.topK).toBe(100)
    expect(generation.maxTokens).toBe(131072)
    expect(generation.presencePenalty).toBe(-2)
    expect(generation.frequencyPenalty).toBe(2)
    expect(generation.repetitionPenalty).toBe(0)
    expect(generation.seed).toBe(0)
    expect(generation.stop).toEqual(['a', 'b', 'c', 'd'])
    expect(generation.thinkingBudget).toBe(0)
  })

  it('旧版全局生成参数迁移到所有模型', () => {
    const config = normalizeConfig({
      // 旧格式模型条目没有 generation
      models: [
        { id: 'a', name: 'A', provider: 'custom', model: 'deepseek-chat', baseUrl: '', apiKey: '' },
        { id: 'b', name: 'B', provider: 'custom', model: 'gpt-4o', baseUrl: '', apiKey: '' },
      ],
      activeModelId: 'a',
      model: 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 8192,
    } as unknown as Partial<PluginConfig>)
    expect(config.models).toHaveLength(2)
    for (const model of config.models) {
      expect(model.generation.temperature).toBe(0.3)
      expect(model.generation.maxTokens).toBe(8192)
    }
  })

  it('新格式 per-model generation 保留各自差异', () => {
    const config = normalizeConfig({
      models: [
        entry({
          id: 'a',
          model: 'deepseek-chat',
          generation: { ...DEFAULT_GENERATION, temperature: 0.2 },
        }),
        entry({
          id: 'b',
          model: 'gpt-4o',
          generation: { ...DEFAULT_GENERATION, temperature: 1.4 },
        }),
      ],
      activeModelId: 'a',
      model: 'deepseek-chat',
    })
    expect(config.models[0].generation.temperature).toBe(0.2)
    expect(config.models[1].generation.temperature).toBe(1.4)
  })

  it('归一化结果不再保留旧版全局生成参数', () => {
    const config = normalizeConfig({
      temperature: 0.5,
      maxTokens: 2048,
      thinkingMode: true,
    } as unknown as Partial<PluginConfig>)
    expect('temperature' in config).toBe(false)
    expect('maxTokens' in config).toBe(false)
    expect('thinkingMode' in config).toBe(false)
    expect(config.models[0].generation.temperature).toBe(0.5)
    expect(config.models[0].generation.maxTokens).toBe(2048)
    expect(config.models[0].generation.thinkingMode).toBe(true)
  })
})

describe('parseExtraBody', () => {
  it('空字符串视为未配置', () => {
    expect(parseExtraBody('')).toEqual({ ok: true })
    expect(parseExtraBody('   ')).toEqual({ ok: true })
  })

  it('接受 JSON 对象', () => {
    const result = parseExtraBody('{"min_p":0.05,"thinking":{"type":"enabled"}}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ min_p: 0.05, thinking: { type: 'enabled' } })
  })

  it('拒绝数组、null 与非法 JSON', () => {
    expect(parseExtraBody('[]').ok).toBe(false)
    expect(parseExtraBody('null').ok).toBe(false)
    expect(parseExtraBody('{bad json').ok).toBe(false)
  })
})
