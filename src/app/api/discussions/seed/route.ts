import { NextResponse } from "next/server";
import { prisma, getDatabaseApiError } from "@/lib/prisma";

const SEED_PROBLEMS = [
  {
    title: "Two Sum",
    description:
      "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.\n\nYou can return the answer in any order.",
    difficulty: "Easy",
    tags: ["Array", "Hash Table"],
  },
  {
    title: "Add Two Numbers",
    description:
      "You are given two non-empty linked lists representing two non-negative integers. The digits are stored in reverse order, and each of their nodes contains a single digit. Add the two numbers and return the sum as a linked list.\n\nYou may assume the two numbers do not contain any leading zero, except the number 0 itself.",
    difficulty: "Medium",
    tags: ["Linked List", "Math", "Recursion"],
  },
  {
    title: "Longest Substring Without Repeating Characters",
    description:
      "Given a string s, find the length of the longest substring without repeating characters.",
    difficulty: "Medium",
    tags: ["Hash Table", "String", "Sliding Window"],
  },
  {
    title: "Median of Two Sorted Arrays",
    description:
      "Given two sorted arrays nums1 and nums2 of size m and n respectively, return the median of the two sorted arrays.\n\nThe overall run time complexity should be O(log (m+n)).",
    difficulty: "Hard",
    tags: ["Array", "Binary Search", "Divide and Conquer"],
  },
  {
    title: "Longest Palindromic Substring",
    description:
      "Given a string s, return the longest palindromic substring in s.\n\nA string is palindromic if it reads the same forward and backward.",
    difficulty: "Medium",
    tags: ["String", "Dynamic Programming"],
  },
  {
    title: "Container With Most Water",
    description:
      "You are given an integer array height of length n. There are n vertical lines drawn such that the two endpoints of the ith line are (i, 0) and (i, height[i]).\n\nFind two lines that together with the x-axis form a container, such that the container contains the most water.\n\nReturn the maximum amount of water a container can store.",
    difficulty: "Medium",
    tags: ["Array", "Two Pointers", "Greedy"],
  },
];

export async function POST() {
  try {
    const existing = await prisma.problem.count();
    if (existing >= SEED_PROBLEMS.length) {
      return NextResponse.json({
        seeded: 0,
        message: "Problems already seeded",
      });
    }

    const existingTitles = new Set(
      (await prisma.problem.findMany({ select: { title: true } })).map(
        (p) => p.title
      )
    );

    const toCreate = SEED_PROBLEMS.filter(
      (p) => !existingTitles.has(p.title)
    );

    if (toCreate.length === 0) {
      return NextResponse.json({
        seeded: 0,
        message: "All problems already exist",
      });
    }

    await prisma.problem.createMany({ data: toCreate });

    return NextResponse.json({
      seeded: toCreate.length,
      message: `Seeded ${toCreate.length} problems`,
    });
  } catch (error) {
    const dbErr = getDatabaseApiError(error);
    if (dbErr) return NextResponse.json({ error: dbErr }, { status: 503 });
    return NextResponse.json(
      { error: "Failed to seed problems" },
      { status: 500 }
    );
  }
}
