import { loadValue } from '@logux/client'
import { atom, onMount } from 'nanostores'

import {
  type CategoryValue,
  feedCategory,
  GENERAL_CATEGORY,
  getCategories
} from './category.js'
import { client } from './client.js'
import { getFeed, getFeeds } from './feed.js'
import { getFilters } from './filter.js'
import { deletePost, getPosts } from './post.js'
import type { PostValue } from './post.js'
import { loadList, readonlyExport } from './utils/stores.js'

function notEmpty<Value>(array: Value[]): array is [Value, ...Value[]] {
  return array.length > 0
}

async function findFastCategories(): Promise<
  [CategoryValue, ...CategoryValue[]]
> {
  let [fastFeeds, fastFilters, categories] = await Promise.all([
    loadList(getFeeds({ reading: 'fast' })),
    loadList(getFilters({ action: 'fast' })),
    loadValue(getCategories())
  ])
  let filterFeeds = await Promise.all(
    fastFilters.map(i => loadValue(getFeed(i.feedId)))
  )
  let uniqueCategories: Record<string, CategoryValue> = {}
  for (let feed of [...fastFeeds, ...filterFeeds]) {
    let id = feedCategory(feed.categoryId, categories)
    if (!uniqueCategories[id]) {
      if (id === 'general') {
        uniqueCategories[id] = GENERAL_CATEGORY
      } else {
        uniqueCategories[id] = categories.list.find(i => i.id === id)!
      }
    }
  }

  let list = Object.values(uniqueCategories).sort((a, b) => {
    return a.title.localeCompare(b.title)
  })

  if (notEmpty(list)) {
    return list
  } else {
    return [GENERAL_CATEGORY]
  }
}

export type FastCategoriesValue =
  | { categories: [CategoryValue, ...CategoryValue[]]; isLoading: false }
  | { isLoading: true }

export const fastCategories = atom<FastCategoriesValue>({ isLoading: true })

onMount(fastCategories, () => {
  fastCategories.set({ isLoading: true })

  let unbindLog: (() => void) | undefined
  let unbindClient = client.subscribe(loguxClient => {
    unbindLog?.()
    unbindLog = undefined

    if (loguxClient) {
      findFastCategories().then(categories => {
        fastCategories.set({ categories, isLoading: false })
      })

      unbindLog = loguxClient.log.on('add', () => {
        findFastCategories().then(categories => {
          fastCategories.set({ categories, isLoading: false })
        })
      })
    }
  })

  return () => {
    unbindLog?.()
    unbindClient()
  }
})

let $loading = atom<'init' | 'next' | false>('init')

export const fastLoading = readonlyExport($loading)

let $posts = atom<PostValue[]>([])

export const fastPosts = readonlyExport($posts)

let $nextSince = atom<number | undefined>()

export const nextFastSince = readonlyExport($nextSince)

let $reading = atom(0)

export const constantFastReading = readonlyExport($reading)

onMount($posts, () => {
  return () => {
    clearFast()
  }
})

let POSTS_PER_PAGE = 50

let currentCategoryId: string | undefined

export function setFastPostsPerPage(value: number): void {
  POSTS_PER_PAGE = value
}

async function loadPosts(categoryId: string, since?: number): Promise<void> {
  let [allFastPosts, categoryFeeds] = await Promise.all([
    loadList(getPosts({ reading: 'fast' })),
    loadList(getFeeds({ categoryId }))
  ])

  let feedIds = new Set(categoryFeeds.map(i => i.id))
  let categoryPosts = allFastPosts.filter(i => feedIds.has(i.feedId))
  let sorted = categoryPosts.sort((a, b) => b.publishedAt - a.publishedAt)
  let fromIndex = since ? sorted.findIndex(i => i.publishedAt < since) : 0
  let posts = sorted.slice(fromIndex, fromIndex + POSTS_PER_PAGE)
  let lastSince
  if (sorted.length > fromIndex + POSTS_PER_PAGE) {
    lastSince = posts[posts.length - 1]?.publishedAt
  }

  $nextSince.set(lastSince)
  $loading.set(false)
  $posts.set(posts)
}

export async function loadFastPost(
  categoryId: string,
  since?: number
): Promise<void> {
  currentCategoryId = categoryId
  $loading.set('init')
  $reading.set(0)
  await loadPosts(categoryId, since)
}

export async function markReadAndLoadNextFastPosts(): Promise<void> {
  if (currentCategoryId) {
    $loading.set('next')
    $reading.set($reading.get() + 1)
    await Promise.all($posts.get().map(({ id }) => deletePost(id)))
    if ($nextSince.get()) {
      await loadPosts(currentCategoryId, $nextSince.get())
    } else {
      $posts.set([])
      $loading.set(false)
    }
  }
}

export function clearFast(): void {
  currentCategoryId = undefined
  $loading.set('init')
  $posts.set([])
  $nextSince.set(undefined)
  $reading.set(0)
  POSTS_PER_PAGE = 50
}